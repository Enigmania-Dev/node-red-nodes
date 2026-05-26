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
        const hints = Array.isArray(config.hints) ? config.hints : [];


        // Initialize context variables
        nodeContext.set("solved", false);  // Unsolved by default
        nodeContext.set("armed", config.autoArm == "true");  // Armed by default
        nodeContext.set("hintIndex", 0);  // Start with the first hint
        nodeContext.set("lastHintTime", 0);  // Time when the last hint was given

        node.warn("AutomatedHintNode initialized with (autoArm): " + JSON.stringify(config.autoArm) + " and hints: " + JSON.stringify(hints));

        node.on('input', function (msg) {
            // If this is reset message
            if (msg.topic == "RESET") {
                nodeContext.set("solved", false);
                nodeContext.set("armed", config.autoArm == "true");
                nodeContext.set("hintIndex", 0);
                nodeContext.set("lastHintTime", 0);
                node.status({});
                return;
            }
            // If this is solved message
            if (msg.topic == "SOLVED") {
                nodeContext.set("solved", true);
                node.status({
                    fill: "grey",
                    shape: "dot",
                    text: "Solved after " + nodeContext.get("hintIndex") + " hints"
                });
                node.send({ topic: "ARM", payload: -1 }); // Send ARM message to arm the next node,
                // restart counter for the next puzzle (since last hint or solved)
                return;
            }
            // If this is arm/disarm message
            if (msg.topic == "ARM") {
                if (nodeContext.get("armed") == true) return
                nodeContext.set("armed", true);
                nodeContext.set("lastHintTime", msg.payload); // set lastHintTime to the time when the node was armed
                node.status({
                    fill: "green",
                    shape: "ring",
                    text: "Ready"
                });
                return;
            }

            // Do nothing if:
            if (
                msg.gameState != "playing" // paused
                || nodeContext.get("armed") == false // not armed yet
                || nodeContext.get("solved") // already solved riddle
                || !("timeElapsed" in msg) // not a time Message
                || hints.length === 0 // no hints configured
            ) {
                if (msg.gameState != "playing") {
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: "Not Playing"
                    });
                } else if (hints.length === 0) {
                    node.status({
                        fill: "grey",
                        shape: "dot",
                        text: "No hints configured"
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
            const elapsedSeconds = Math.floor(Number(msg.timeElapsed) / 1000);
            if (isNaN(elapsedSeconds)) {
                node.warn("Received invalid timeElapsed value: " + msg.timeElapsed);
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
                node.send(msg);

                // If there are no more hints, arm the next node
                if (nodeContext.get("hintIndex") >= hints.length) {
                    node.send({ topic: "ARM", payload: nodeContext.get("lastHintTime") }); // Send ARM message to arm the next node
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