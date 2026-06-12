module.exports = function (RED) {
    function HintUINode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        const nodeContext = node.context();
        nodeContext.set("states", {}); // Start with empty state

        node.on('input', function (msg) {
            // Get individual entries for each node (max one per node)
            let state = nodeContext.get("states") || {};
            if (msg.topic === "STATE") {
                msg.payload.forEach(item => {
                    if (!item.id) return; // Skip if no id is provided
                    state[item.id] = {
                        time: item.time,
                        description: item.description,
                        formatTime: item.formatTime
                    };
                });
                nodeContext.set("states", state);
            }

            let schedule = Object.values(state);

            // Sort by time and take the next ones based on the number of outputs
            schedule.sort((a, b) => a.time - b.time);

            node.send(schedule
                .filter(item => isFinite(item.time) && item.time >= 0)
                .concat(Array(config.outputs || 1)
                    .fill({ time: Infinity, description: '' }))
                .slice(0, config.outputs || 1)
                .map(item => {
                    return {
                        topic: "HINT_SCHEDULE",
                        payload: {
                            time: item.formatTime || item.time,
                            description: item.description,
                        }
                    }
                }));
        })
    }
    RED.nodes.registerType("HintUI", HintUINode);
}