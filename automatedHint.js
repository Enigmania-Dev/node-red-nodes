module.exports = function (RED) {
    function AutomatedHintNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        const nodeContext = node.context();
        const hints = Array.isArray(config.hints) ? config.hints : [];


        // Initialize context variables
        nodeContext.set("solved", false);  // Unsolved by default
        nodeContext.set("hintIndex", 0);  // Start with the first hint
        nodeContext.set("lastHintTime", 0);  // Time when the last hint was given

        node.warn("AutomatedHintNode initialized with hints: " + JSON.stringify(hints));

        node.on('input', function (msg) {

            // If this is reset message
            if (msg.topic == "RESET") {
                nodeContext.set("solved", false);
                nodeContext.set("hintIndex", 0);
                nodeContext.set("lastHintTime", 0);
                node.status({});
                return;
            }
            // If this is solved message
            if (msg.topic == "SOLVED") {
                nodeContext.set("solved", true);
                node.status({ fill: "grey", shape: "ring", text: "Solved after " + nodeContext.get("hintIndex") + " hints" });
                return;
            }

            // Do nothing if:
            if (
                msg.gameState != "playing" // paused
                || nodeContext.get("solved") // already solved riddle
                || !("timeElapsed" in msg) // not a time Message
            ) {
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

            // If next hint is due, send it and update context
            if (elapsedSeconds - nodeContext.get("lastHintTime") >= timeToNextHint) {
                nodeContext.set("hintIndex", nodeContext.get("hintIndex") + 1);
                nodeContext.set("lastHintTime", elapsedSeconds);
                msg.payload = hint.message;
                node.send(msg);
            }

            // Update node status with the time until the next hint or indicate that there are no more hints
            if (timeToNextHint !== Infinity) {
                node.status({ fill: "blue", shape: "ring", text: `Hint ${nodeContext.get("hintIndex")+1} in ${timeToNextHint - elapsedSeconds}s` });
            } else {
                node.status({ fill: "blue", shape: "ring", text: `No more hints` });
            }
            
            return;
        });
    }
    RED.nodes.registerType("AutomatedHint", AutomatedHintNode);
}