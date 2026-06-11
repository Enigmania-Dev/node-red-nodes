let { stringSimilarity } = require("string-similarity-js");

module.exports = function (RED) {
    function StringSimilarity(config) {
        RED.nodes.createNode(this, config);
        const correct = config.correct || "";
        const node = this;

        node.on("input", function (msg) {
            const stringInput = msg.payload;

            if (typeof stringInput === "string") {
                const similarityScore = stringSimilarity(stringInput, correct);
                if (similarityScore >= config.threshold) {
                    msg.similarity = similarityScore;
                    node.send(msg);
                } else {
                    node.warn(`${stringInput} is not similar enough to ${correct} (score: ${similarityScore} < ${config.threshold})`);
                }
            } else {
                node.error("Payload must be a string");
            }
        })


    }
    RED.nodes.registerType("stringSimilarity", StringSimilarity);
}