function formatSeconds(seconds) {
    if (seconds === undefined || seconds === null || isNaN(seconds)) {
        return "";
    }
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

module.exports = function (RED) {
    function HintUINode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        var flowContext = node.context().flow;

        flowContext.set("schedule", {}); // Initialize schedule in flow context

        node.on('input', function (msg) {
            // Get individual entries for each node (max one per node)
            let schedule = Object.values(flowContext.get("schedule") || {});

            // Sort by time and take the next ones based on the number of outputs
            schedule.sort((a, b) => a.time - b.time);

            console.log("Current schedule:", flowContext.get("schedule"));
            node.send(schedule
                .concat(Array(config.outputs || 1).fill({time: '', description: ''}))
                .slice(0, config.outputs || 1)
                .map(item => {
                return {
                    topic: "HINT_SCHEDULE",
                    payload: {
                        time: formatSeconds(item.time),
                        description: item.description,
                    }
                }
            }));
        })
    }
    RED.nodes.registerType("HintUI", HintUINode);
}