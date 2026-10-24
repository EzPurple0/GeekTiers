// Geek Tierlist server: serves the page and stores players for everyone.
// No dependencies. Run with:  node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DEV_CODE = process.env.DEV_CODE || "finxcertXD";
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "players.json");

const MODES = ["Vanilla", "UHC", "Pot", "NethOP", "SMP", "Sword", "Axe", "Mace"];
const TIERS = ["HT1", "LT1", "HT2", "LT2", "HT3", "LT3", "HT4", "LT4", "HT5", "LT5"];

let players = [];
try {
    players = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch {
    players = [];
}

function save() {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(players, null, 2));
    fs.renameSync(tmp, DATA_FILE);
}

const tokens = new Set();
const attempts = new Map(); // ip -> { count, until }

function send(res, status, body, type = "application/json") {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", chunk => {
            data += chunk;
            if (data.length > 10000) {
                reject(new Error("too large"));
                req.destroy();
            }
        });
        req.on("end", () => {
            try { resolve(data ? JSON.parse(data) : {}); }
            catch (e) { reject(e); }
        });
    });
}

function isAuthed(req) {
    const header = req.headers["authorization"] || "";
    return tokens.has(header.replace("Bearer ", ""));
}

function safeEqual(a, b) {
    const ha = crypto.createHash("sha256").update(String(a)).digest();
    const hb = crypto.createHash("sha256").update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

const server = http.createServer(async (req, res) => {
    const url = req.url.split("?")[0];

    try {
        if (req.method === "GET" && (url === "/" || url === "/index.html")) {
            return send(res, 200, fs.readFileSync(path.join(__dirname, "index.html")), "text/html; charset=utf-8");
        }

        if (req.method === "GET" && url === "/api/players") {
            return send(res, 200, players);
        }

        if (req.method === "POST" && url === "/api/login") {
            const ip = req.socket.remoteAddress;
            const info = attempts.get(ip) || { count: 0, until: 0 };

            if (Date.now() < info.until) {
                return send(res, 429, { error: "Too many attempts. Try again later." });
            }

            const { code } = await readBody(req);

            if (typeof code === "string" && safeEqual(code, DEV_CODE)) {
                attempts.delete(ip);
                const token = crypto.randomBytes(24).toString("hex");
                tokens.add(token);
                return send(res, 200, { token });
            }

            info.count++;
            if (info.count >= 5) {
                info.until = Date.now() + 5 * 60 * 1000;
                info.count = 0;
            }
            attempts.set(ip, info);
            return send(res, 401, { error: "Wrong code." });
        }

        if (req.method === "POST" && url === "/api/players") {
            if (!isAuthed(req)) return send(res, 401, { error: "Not logged in." });

            const { username, mode, tier } = await readBody(req);

            if (typeof username !== "string" || !/^[A-Za-z0-9_]{1,16}$/.test(username)) {
                return send(res, 400, { error: "Invalid Minecraft username." });
            }
            if (!MODES.includes(mode) || !TIERS.includes(tier)) {
                return send(res, 400, { error: "Invalid gamemode or tier." });
            }

            let player = players.find(p => p.username.toLowerCase() === username.toLowerCase());

            if (!player) {
                const tiers = {};
                MODES.forEach(m => tiers[m] = null);
                player = { username, tiers };
                players.push(player);
            }

            player.tiers[mode] = tier;
            save();
            return send(res, 200, players);
        }

        if (req.method === "DELETE" && url.startsWith("/api/players/")) {
            if (!isAuthed(req)) return send(res, 401, { error: "Not logged in." });

            const name = decodeURIComponent(url.slice("/api/players/".length)).toLowerCase();
            players = players.filter(p => p.username.toLowerCase() !== name);
            save();
            return send(res, 200, players);
        }

        send(res, 404, { error: "Not found." });
    } catch (err) {
        send(res, 400, { error: "Bad request." });
    }
});

server.listen(PORT, () => {
    console.log(`Geek Tierlist running on http://localhost:${PORT}`);
});
