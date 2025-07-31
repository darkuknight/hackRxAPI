const axios = require("axios");
const Together = require("together-ai");
const { encode, decode } = require("gpt-3-encoder");
const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });

const parseDoc = async (doc) => {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const response = await axios.get(doc, {
        responseType: "arraybuffer",
    });
    const uint8Array = new Uint8Array(response.data);
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const pdf = await loadingTask.promise;

    const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1))
    );

    const contents = await Promise.all(
        pages.map((page) => page.getTextContent())
    );

    const fullText = contents
        .map((content) =>
            content.items
                .map((item) => ("str" in item ? item.str : ""))
                .join(" ")
        )
        .join("\n");

    return fullText;
};
const chunkDocument = (text, maxTokens = 300) => {
    const tokens = encode(text);
    const chunks = [];
    for (let i = 0; i < tokens.length; i += maxTokens) {
        const chunk = tokens.slice(i, i + maxTokens);
        chunks.push(decode(chunk));
    }
    return chunks;
};
async function embedChunks(chunks) {
    const response = await together.embeddings.create({
        model: "BAAI/bge-base-en-v1.5",
        input: chunks,
    });
    return response.data.map((d) => d.embedding);
}
async function embedQuestions(questions) {
    const response = await together.embeddings.create({
        model: "BAAI/bge-base-en-v1.5",
        input: questions,
    });
    return response.data.map((d) => d.embedding);
}
function cosineSimilarity(a, b) {
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val ** 2, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val ** 2, 0));
    return dot / (magA * magB);
}
function getTopKChunks(queryVector, chunkVectors, chunks, k = 3) {
    const scored = chunkVectors.map((vec, i) => ({
        text: chunks[i],
        score: cosineSimilarity(queryVector, vec),
    }));

    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((s) => s.text);
}
const answerChunks = async (chunks, questions) => {
    return Promise.all(
        questions.map(async (query) => {
            const ans = await together.chat.completions.create({
                model: "lgai/exaone-3-5-32b-instruct",
                messages: [
                    {
                        role: "system",
                        content: `You are a helpful assistant...
                        answer the question using the context below, ensure the answers precise and one sentenced.
                        answers must be confident and accurate according to the context.
                        -------------------------------\n
                        context:\n${chunks.join("\n\n")}\n
                        --------------------------------`,
                    },
                    { role: "user", content: query },
                ],
            });
            return ans.choices?.[0]?.message?.content || "No answer";
        })
    );
};
const handle = async (req, res) => {
    const token = req.headers.authorization;
    if (!token?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const bearerToken = token.split(" ")[1];
    if (bearerToken !== process.env.TOKEN) {
        return res.status(401).send("unauthorized");
    }

    const { documents, questions } = req.body || {};

    const parsedDoc = await parseDoc(documents);

    const chunks = chunkDocument(parsedDoc);
    const [chunkVector, questionVector] = await Promise.all([
        embedChunks(chunks),
        embedQuestions(questions),
    ]);
    const answers = await Promise.all(
        questions.map(async (q, i) => {
            const topChunks = getTopKChunks(
                questionVector[i],
                chunkVector,
                chunks
            );
            const [answer] = await answerChunks(topChunks, [q]);
            return answer;
        })
    );

    const responsePayload = {
        answers,
    };
    return res.json(responsePayload);
};

module.exports = { handle };
