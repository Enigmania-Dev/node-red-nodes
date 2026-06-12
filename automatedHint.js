function formatSeconds(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) {
        return "";
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')} `;
}

module.exports = function (RED) {
    function AutomatedHintNode(config) {
        RED.nodes.createNode(this, config);

        // const variables
        const node = this;
        const flowContext = this.context().flow;
        const hints = Array.isArray(config.hints) ? config.hints : [];
        const conditions = Array.isArray(config.conditions) ? config.conditions : [];


        // Initialize variables
        var timers = Array(hints.length).fill(Infinity); // Store timers for hints
        var hintIndex = 0; // Track which hint is next
        var elapsedSeconds = 0; // Track elapsed time in seconds
        var conditionsValidated = 0; // Track whether conditions have been validated
        var conditionsMet = false; // Track whether conditions are currently met
        var forceReady = false; // Track whether the node has been forced ready

        function initialize() {
            timers = Array(hints.length).fill(Infinity); // Reset timers
            hintIndex = 0; // Reset hint index
            elapsedSeconds = 0;
            conditionsMet = false; // Reset conditions met
            forceReady = false; // Reset force ready

            // also add a variable to the flow context to track whether this node's riddle is solved, which can be used as a condition for other nodes
            flowContext.set(config.name + "_solved", false);

            if (config.mode === "TIME") {
                calculateHintTimes(0); // Pre-calculate hint times for time-based hints
            }
        }

        function calculateNextHintTime(elapsedSeconds, hint) {
            if (hint === undefined) {
                return Infinity;
            }
            if (config.mode === "TIME") {
                return elapsedSeconds + hint.time;
            }
            if (config.mode === "STATE") {
                const minTime = hint.min || 0;
                const maxTime = hint.max || Infinity;
                const targetTime = hint.target || null;

                // If targetTime is specified, calculate the optimal time to trigger the hint
                if (targetTime !== null) {
                    const targetDiff = targetTime - elapsedSeconds;
                    // if we are already past the target time, trigger immediately after minTime
                    if (minTime > targetDiff) {
                        return elapsedSeconds + minTime;
                    }
                    // if we are before the target time but maxTime would cause us to miss it, 
                    // trigger as late as possible before targetTime
                    if (maxTime < targetDiff) {
                        return elapsedSeconds + maxTime;
                    }
                    // Trigger at targetTime
                    return targetTime;
                }
                // If no targetTime is specified, trigger as soon as minTime has passed
                return elapsedSeconds + minTime;
            }
            return Infinity; // Default to never if mode is unrecognized
        }

        function calculateHintTimes(elapsedSeconds) {
            var time = elapsedSeconds;
            for (let i = 0; i < hints.length; i++) {
                const hint = hints[i];
                const hintTime = calculateNextHintTime(time, hint);
                timers[i] = hintTime;
                time = hintTime; // For time-based hints, the next hint's time is relative to the previous hint
            }
        }

        function sendMessage(hintMsg = null, log = null) {
            // calculate hint states for all hints
            let hintStates = hints.map((hint, index) => {
                return {
                    id: config.name + "H"+ index,
                    time: flowContext.get(config.name + "_solved") ? Infinity : timers[index] - elapsedSeconds,
                    formatTime: formatSeconds(timers[index] - elapsedSeconds),
                    description: (config.description || config.name) + " - Hint " + (index + 1),
                }
            });

            // Ensure formatting
            if (hintMsg != null) {
                hintMsg.topic = "HINT";
                // If this is a hint, index was already incremented
                hintMsg.description = (config.description || config.name) + " - Hint " + hintIndex;

                if (log == null)
                    log = `${config.name}: ${config.description} - Hint ${hintIndex}`;

            }
            // make into message
            if (log != null) {
                log = {
                    topic: "LOG",
                    time: formatSeconds(elapsedSeconds),
                    payload: log
                }
            }
            node.send([[
                hintMsg,
                {
                    topic: "STATE",
                    payload: hintStates
                },
                log
            ]])
        }

        initialize();

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
        node.on('close', function () {
            // Remove self from the list of hint nodes in the flow context
            let hintNodes = flowContext.get("hintNodes") || [];
            hintNodes = hintNodes.filter(name => name !== config.name);
            flowContext.set("hintNodes", hintNodes);
            flowContext.set(config.name + "_solved", false);
        });

        node.on('input', function (msg) {
            // check if conditions exist on first run
            if (conditionsValidated == 0) {
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
                        conditionsValidated = -1;
                        return; // If any condition is not met, do not proceed
                    }
                    conditionsValidated = 1;
                }
            } else if (conditionsValidated == -1) {
                return; // If conditions were previously found to be invalid, do not proceed
            }

            // If this is reset message
            if (msg.topic == "RESET") {
                initialize();
                node.status({});
                sendMessage();
                return;
            }
            // If this is solved message
            if (msg.topic == "SOLVED") {
                flowContext.set(config.name + "_solved", true);
                node.status({
                    fill: "grey",
                    shape: "dot",
                    text: "Solved after " + hintIndex + " hints"
                });
                sendMessage(null, `${config.name}: ${config.description || ''} solved`);
                return;
            }
            // If this is a force ready message
            if (msg.topic == "CONDITIONS_MET") {
                forceReady = true;
                // If we are in state-based mode, this should trigger the timer for the first hint,
                // so we recalculate the next hint time based on the current elapsed time
                if (config.mode === "STATE") {
                    calculateHintTimes(elapsedSeconds);
                }
                // Now send status update and log message
                sendMessage(null, `${config.name}: ${config.description || ''} activated`);
                return;
            }

            // convert timeElapsed to seconds and find the hint for the current elapsed time
            _e = Math.floor(Number(msg.payload) / 1000);
            if (isNaN(_e)) {
                node.warn("Received invalid timeElapsed value: " + msg.payload);
                return;
            }
            elapsedSeconds = _e;

            // Do nothing if:
            if (
                msg.gameState != "playing" // paused
                || flowContext.get(config.name + "_solved") // already solved riddle
                || msg.topic != "TIME" // only react to time messages
                || hints.length === 0 // no hints configured
                || hints.length <= hintIndex // all hints already given
            ) {
                if (flowContext.get(config.name + "_solved")) {
                    node.status({
                        fill: "grey",
                        shape: "dot",
                        text: "Solved after " + hintIndex + " hints"
                    });
                }
                else if (hints.length === 0) {
                    node.status({
                        fill: "grey",
                        shape: "dot",
                        text: "No hints configured"
                    });
                } else if (hints.length <= hintIndex) {
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
                sendMessage();
                return;
            }

            // Evaluate conditions:
            var localConditionsMet = (
                ( // If no conditions, wait for force ready message, otherwise check conditions
                    conditions.length > 0
                    && conditions.every(
                        condition => flowContext.get(condition + "_solved") === true
                    )
                )
                || forceReady === true // allow to force conditions met via message
            );
            // If all conditions are met and we haven't already marked them as met, do so now
            if (localConditionsMet && conditionsMet === false) {
                if (config.mode === "STATE") {
                    // Start timer now, only if we are in state-based mode,
                    // in time-based mode the timer starts with the game
                    calculateHintTimes(elapsedSeconds);
                    sendMessage(null, `${config.name}: ${config.description} activated`);
                }
                conditionsMet = true;
            }

            if (localConditionsMet == false && config.mode === "STATE") {
                node.status({
                    fill: "blue",
                    shape: "ring",
                    text: "Waiting for conditions"
                });
                sendMessage();
                return; // If any condition is not met, do not proceed
            }

            const hint = hints[hintIndex];

            // If next hint is due, send it and update context
            if (elapsedSeconds >= timers[hintIndex]) {
                // If we are more than 1 second past the hint time, add delay to all subsequent hints
                // to avoid multiple hints triggering at once too quickly
                if (elapsedSeconds - timers[hintIndex] > 1 ) {
                    for (let i = hintIndex + 1; i < hints.length; i++) {   
                        timers[i] += elapsedSeconds - timers[hintIndex]; 
                    }
                }

                hintIndex++;

                msg.payload = hint.message;
                sendMessage(msg);
            } else {
                sendMessage();
            }

            // Update node status with the time until the next hint or indicate that there are no more hints
            if (hintIndex < hints.length && isFinite(timers[hintIndex] - elapsedSeconds)) {
                const timeStr = formatSeconds(timers[hintIndex] - elapsedSeconds);
                node.status({
                    fill: "green",
                    shape: "ring",
                    text: `Hint ${hintIndex + 1} in ${timeStr}`
                });
            }

            return;
        });
    }
    RED.nodes.registerType("AutomatedHint", AutomatedHintNode);
}