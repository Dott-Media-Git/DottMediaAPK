"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
// CORS for basic frontend access (adjust origin if needed)
app.use((0, cors_1.default)({ origin: true }));
// Health check
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));
// Webhooks: keep raw body
app.post('/meta/webhook', express_1.default.raw({ type: '*/*' }), (req, res) => {
    // req.body is a Buffer; handle as needed
    res.status(200).send('OK');
});
app.post('/linkedin/webhook', express_1.default.raw({ type: '*/*' }), (req, res) => {
    res.status(200).send('OK');
});
// JSON parser for the rest of the routes
app.use(express_1.default.json());
exports.default = app;
//# sourceMappingURL=app.js.map