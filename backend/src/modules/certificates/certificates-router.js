const express = require("express");
const asyncHandler = require("express-async-handler");
const { authenticateToken, csrfProtection } = require("../../middlewares");
const { createRepository } = require("./certificates-repository");
const { createChain, createIpfs } = require("./certificates-adapters");
const { createCertificateService } = require("./certificates-service");

const service = createCertificateService({ repository: createRepository(), chain: createChain(), ipfs: createIpfs() });
const router = express.Router();

// Public verification intentionally precedes session and CSRF middleware.
router.get("/verify/:id", asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await service.verify(req.params.id));
}));
router.use(authenticateToken, csrfProtection);
router.get("/config", asyncHandler(async (_req, res) => res.json(await service.config())));
router.get("/", asyncHandler(async (req, res) => res.json({ certificates: await service.list(req.user, req.query.studentId) })));
router.get("/:id", asyncHandler(async (req, res) => res.json({ certificate: await service.get(req.user, req.params.id) })));
router.post("/", asyncHandler(async (req, res) => {
  const certificate = await service.create(req.user, req.body, req.get("Idempotency-Key"));
  const status = certificate.status === "failed" ? 503 : certificate.status === "pending" ? 202 : 201;
  res.status(status).json({ certificate, ...(status === 503 ? { error: certificate.error } : {}) });
}));
router.post("/:id/retry", asyncHandler(async (req, res) => {
  const certificate = await service.retry(req.user, req.params.id);
  const status = certificate.status === "failed" ? 503 : certificate.status === "pending" ? 202 : 200;
  res.status(status).json({ certificate, ...(status === 503 ? { error: certificate.error } : {}) });
}));
router.post("/:id/revoke", asyncHandler(async (req, res) => {
  const certificate = await service.revoke(req.user, req.params.id);
  const status = certificate.status === "revoked" ? 200 : certificate.revocationTransactionHash ? 202 : 503;
  res.status(status).json({ certificate, ...(status === 503 ? { error: certificate.error } : {}) });
}));

module.exports = { certificatesRoutes: router };
