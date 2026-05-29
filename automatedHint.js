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


        // Initialize context variables
        nodeContext.set("hintIndex", 0);  // Start with the first hint
        nodeContext.set("lastHintTime", 0);  // Time when the last hint was given
        nodeContext.set("conditionsValidated", 0); // Whether the conditions have been validated

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

        node.on('close', function() {
            // Remove self from the list of hint nodes in the flow context
            let hintNodes = flowContext.get("hintNodes") || [];
            hintNodes = hintNodes.filter(name => name !== config.name);
            flowContext.set("hintNodes", hintNodes);
            flowContext.set(config.name+"_solved", false);
        });

        node.on('input', function (msg) {
            // check if conditions exist
            if (nodeContext.get("conditionsValidated") == 0) {
                const conditions = Array.isArray(config.conditions) ? config.conditions : [];
                if (conditions.length > 0) {
                    const knownNodes = flowContext.get("hintNodes") || [];
                    const allConditionsMet = conditions.every(condition => {
                        // check if condition is the name of a node in the flow context
                        return (
                            knownNodes.includes(condition) 
                            || node.warn(
                                `Condition "${condition}" is not the name of any riddle-node in the flow context. Please check your conditions.`
                            ));
                        
                    });
                    if (!allConditionsMet) {
                        node.warn(`Conditions: ${flowContext.get("hintNodes")} - ${conditions}`);
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: `Invalid conditions`
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
                nodeContext.set("armed", config.autoArm == "true");
                nodeContext.set("hintIndex", 0);
                nodeContext.set("lastHintTime", 0);
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
                // compute the time when the next hint should have come:
                const hint = hints[nodeContext.get("hintIndex")];
                if (!hint) {
                    node.send([null, { topic: "ARM", payload: -1 }]); // Send ARM message to arm the next node,
                    // restart counter for the next puzzle (since last hint or solved)
                    return;
                }
                const nextHintTime = nodeContext.get("lastHintTime") + hint.time;
                node.send([null, { topic: "ARM", payload: nextHintTime }]); // Send ARM message to arm the next node with the time when the next hint would have come
            }

            // Do nothing if:
            if (
                msg.gameState != "playing" // paused
                || flowContext.get(config.name+"_solved") // already solved riddle
                || msg.topic != "TIME" // only react to time messages
                || hints.length === 0 // no hints configured
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
                } else if (msg.gameState != "playing") {
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: "Not Playing"
                    });
                } else if (nodeContext.get("armed") == false) {
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: "Wait for previous hint"
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

            const hintIndex = nodeContext.get("hintIndex");
            const hint = hints[hintIndex];
            const timeToNextHint = hint ? hint.time : Infinity;

            // In case the node was just armed, set the lastHintTime to the current elapsed time to start the timer
            if (nodeContext.get("lastHintTime") < 0) {
                nodeContext.set("lastHintTime", elapsedSeconds);
            }

            // If next hint is due, send it and update context
            if (elapsedSeconds - nodeContext.get("lastHintTime") >= timeToNextHint) {
                nodeContext.set("hintIndex", nodeContext.get("hintIndex") + 1);
                nodeContext.set("lastHintTime", elapsedSeconds);
                msg.topic = "HINT";
                msg.payload = hint.message;
                
                // If there are no more hints, arm the next node
                if (nodeContext.get("hintIndex") >= hints.length) {
                    node.send([msg, { topic: "ARM", payload: nodeContext.get("lastHintTime") }]); // Send ARM message to arm the next node
                } else {
                    node.send([msg, null]);
                }
            }

            // Update node status with the time until the next hint or indicate that there are no more hints
            if (timeToNextHint !== Infinity) {
                const timeStr = formatSeconds(timeToNextHint - (elapsedSeconds - nodeContext.get("lastHintTime")));
                node.status({
                    fill: "green",
                    shape: "ring",
                    text: `Hint ${nodeContext.get("hintIndex")+1} in ${timeStr}`
                });
            } else {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: `No more hints`
                });
            }
            
            return;
        });
    }
    RED.nodes.registerType("AutomatedHint", AutomatedHintNode);
}