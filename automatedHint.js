function formatSeconds(seconds) {
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

module.exports = function (RED) {
    function AutomatedHintNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        const nodeContext = node.context();
        const flowContext = this.context().flow;
        const hints = Array.isArray(config.hints) ? config.hints : [];
        const conditions = Array.isArray(config.conditions) ? config.conditions : [];


        // Initialize context variables
        nodeContext.set("hintIndex", 0);  // Start with the first hint
        nodeContext.set("timer", 0);  // Time when the last hint was given
        nodeContext.set("conditionsValidated", 0); // Whether the conditions have been validated
        nodeContext.set("conditionsMet", false); // Whether the conditions are currently met
        nodeContext.set("forceReady", false); // Whether the node has been forced ready

        // also add a variable to the flow context to track whether this node's riddle is solved, which can be used as a condition for other nodes
        flowContext.set(config.name+"_solved", false); 

        // Add self to the list of hint nodes in the flow context
        let hintNodes = flowContext.get("hintNodes") || [];
        if (hintNodes.includes(config.name)) {
            node.warn(`A node with the name "${config.name}" already exists in the flow context. Please ensure unique names for each AutomatedHint node.`);
            node.status({
                fill: "red",
                shape: "dot",
                text: `Duplicate node name in flow context`
            });
            return;
        }
        hintNodes.push(config.name);
        flowContext.set("hintNodes", hintNodes);
        
        // When the node is closed, remove it from the flow context and mark its riddle as unsolved
        node.on('close', function() {
            // Remove self from the list of hint nodes in the flow context
            let hintNodes = flowContext.get("hintNodes") || [];
            hintNodes = hintNodes.filter(name => name !== config.name);
            flowContext.set("hintNodes", hintNodes);
            flowContext.set(config.name+"_solved", false);
        });

        node.on('input', function (msg) {
            // check if conditions exist on first run
            if (nodeContext.get("conditionsValidated") == 0) {
                const conditions = Array.isArray(config.conditions) ? config.conditions : [];
                if (conditions.length > 0) {
                    const knownNodes = flowContext.get("hintNodes") || [];
                    const allConditionsMet = conditions.every(condition => {
                        // check if condition is the name of a node in the flow context
                        return (
                            knownNodes.includes(condition)
                            && condition != config.name // also check that the node does not depend on itself, which would lead to a deadlock
                            || node.warn(
                                `Condition "${condition}" is not the name of any riddle-node in the flow context. Please check your conditions.`
                            ));
                        
                    });
                    if (!allConditionsMet) {
                        node.warn(`Conditions: ${flowContext.get("hintNodes")} - ${conditions}`);
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: `Depends on unknown riddle`
                        });
                        nodeContext.set("conditionsValidated", -1);
                        return; // If any condition is not met, do not proceed
                    }
                    nodeContext.set("conditionsValidated", 1);
                }
            } else if (nodeContext.get("conditionsValidated") == -1) {
                return; // If conditions were previously found to be invalid, do not proceed
            }

            // If this is reset message
            if (msg.topic == "RESET") {
                flowContext.set(config.name+"_solved", false);
                nodeContext.set("hintIndex", 0);
                nodeContext.set("timer", 0);
                nodeContext.set("forceReady", false);
                node.status({});
                return;
            }
            // If this is solved message
            if (msg.topic == "SOLVED") {
                flowContext.set(config.name+"_solved", true);
                node.status({
                    fill: "grey",
                    shape: "dot",
                    text: "Solved after " + nodeContext.get("hintIndex") + " hints"
                });
                return;
            }
            // If this is a force ready message
            if (msg.topic == "CONDITIONS_MET") {
                nodeContext.set("forceReady", true);
                return;
            }


            // Do nothing if:
            if (
                msg.gameState != "playing" // paused
                || flowContext.get(config.name+"_solved") // already solved riddle
                || msg.topic != "TIME" // only react to time messages
                || hints.length === 0 // no hints configured
                || hints.length <= nodeContext.get("hintIndex") // all hints already given
            ) {
                if (flowContext.get(config.name+"_solved")) {
                    node.status({
                        fill: "grey",
                        shape: "dot",
                        text: "Solved after " + nodeContext.get("hintIndex") + " hints"
                    });
                }
                else if (hints.length === 0) {
                    node.status({
                        fill: "grey",
                        shape: "dot",
                        text: "No hints configured"
                    });
                } else if(hints.length <= nodeContext.get("hintIndex")) {
                    node.status({
                        fill: "red",
                        shape: "dot",
                        text: "No more hints"
                    });

                } else if (msg.gameState != "playing") {
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: "Not Playing"
                    });
                }
                return;
            }

            // convert timeElapsed to seconds and find the hint for the current elapsed time
            const elapsedSeconds = Math.floor(Number(msg.payload) / 1000);
            if (isNaN(elapsedSeconds)) {
                node.warn("Received invalid timeElapsed value: " + msg.payload);
                return;
            }

            // Evaluate conditions:
            allConditionsMet = (
                ( // If no conditions, wait for force ready message, otherwise check conditions
                    conditions.length > 0
                    && conditions.every(
                        condition => flowContext.get(condition+"_solved") === true
                    )
                )
                || nodeContext.get("forceReady") === true // allow to force conditions met via message
            );
            // If all conditions are met and we haven't already marked them as met, do so now
            if (allConditionsMet && nodeContext.get("conditionsMet") === false) {
                if (config.mode === "STATE") {
                    // Start timer now, only if we are in state-based mode, in time-based mode the timer starts with the game
                    nodeContext.set("timer", elapsedSeconds);
                }
                nodeContext.set("conditionsMet", true);
            }

            if (allConditionsMet == false && config.mode === "STATE") {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: "Waiting for conditions"
                });
                return; // If any condition is not met, do not proceed
            } 

            const hint = hints[nodeContext.get("hintIndex")];
            // Calculate time to next hint based on mode
            let nextHintTime = Infinity;
            if (config.mode === "TIME") {
                nextHintTime = hint.time;
            } else if (config.mode === "STATE") {
                const minTime = hint.min || 0;
                const maxTime = hint.max || Infinity;
                const targetTime = hint.target || null;

                // If targetTime is specified, calculate the optimal time to trigger the hint
                if (targetTime !== null) {
                    const earliestTriggerTime = nodeContext.get("timer") + minTime;
                    const latestTriggerTime = nodeContext.get("timer") + maxTime;

                    if (earliestTriggerTime > targetTime) {
                        nextHintTime = minTime; // Trigger as soon as possible after minTime
                    } else if (latestTriggerTime < targetTime) {
                        nextHintTime = maxTime; // Trigger as late as possible before maxTime
                    } else {
                        nextHintTime = targetTime - nodeContext.get("timer"); // Trigger at targetTime
                    }
                } else {
                    // If no targetTime, trigger as soon as minTime has passed
                    nextHintTime = minTime;
                }
            }

            // If next hint is due, send it and update context
            if (elapsedSeconds - nodeContext.get("timer") >= nextHintTime) {
                nodeContext.set("hintIndex", nodeContext.get("hintIndex") + 1);
                nodeContext.set("timer", elapsedSeconds);
                msg.topic = "HINT";
                msg.payload = hint.message;
                
                node.send(msg);
            }

            // Update node status with the time until the next hint or indicate that there are no more hints
            if (nextHintTime !== Infinity) {
                const timeStr = formatSeconds(Math.max(0, nextHintTime - (elapsedSeconds - nodeContext.get("timer"))));
                node.status({
                    fill: "green",
                    shape: "ring",
                    text: `Hint ${nodeContext.get("hintIndex")+1} in ${timeStr}`
                });
            }
            
            return;
        });
    }
    RED.nodes.registerType("AutomatedHint", AutomatedHintNode);
}