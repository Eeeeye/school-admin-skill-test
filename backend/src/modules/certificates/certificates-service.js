const { randomBytes } = require("node:crypto");
const { getAddress, ZeroAddress } = require("ethers");
const { ApiError } = require("../../utils/api-error");

function positiveId(value, label = "Student ID") {
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))
      || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
    throw new ApiError(400, `${label} must be a positive integer`);
  }
  return Number(value);
}

function certificateId(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value)) {
    throw new ApiError(400, "Certificate ID must be a nonzero 32-byte hexadecimal value");
  }
  return value.toLowerCase();
}

function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "Invalid certificate input");
  const studentId = positiveId(input.studentId);
  if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 120) {
    throw new ApiError(400, "Certificate title must contain 1 to 120 characters");
  }
  const description = input.description ?? "";
  if (typeof description !== "string" || description.trim().length > 1000) {
    throw new ApiError(400, "Certificate description must contain at most 1000 characters");
  }
  let recipientAddress;
  try {
    recipientAddress = getAddress(input.recipientAddress);
    if (recipientAddress === ZeroAddress) throw new Error("zero");
  } catch (_error) {
    throw new ApiError(400, "Recipient must be a valid, nonzero Ethereum address");
  }
  return { studentId, title: input.title.trim(), description: description.trim(), recipientAddress };
}

function requireAdmin(user) {
  if (Number(user.roleId) !== 1) throw new ApiError(403, "Only school administrators can manage certificates");
}

function sameAddress(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

function metadataFor(row) {
  // This document becomes publicly retrievable. Never add student name, email,
  // internal user ID, grades or other personal information here implicitly.
  return { schema: "school-certificate/v1", certificateId: row.id, title: row.title,
    description: row.description, recipientAddress: row.recipientAddress };
}

function metadataMatches(row, chain, metadata) {
  return metadata.schema === "school-certificate/v1" && metadata.certificateId === row.id
    && sameAddress(metadata.recipientAddress, chain.recipientAddress)
    && metadata.title === row.title && metadata.description === row.description
    && sameAddress(row.recipientAddress, chain.recipientAddress)
    && row.metadataCid === chain.metadataCid;
}

function createCertificateService({ repository, chain, ipfs, env = process.env }) {
  const verificationUrl = (id) => `${(env.UI_URL || "http://localhost:5173").replace(/\/$/, "")}/verify/${id}`;
  const publicRow = (row) => {
    if (!row) return row;
    return { ...row, chainId: row.chainId == null ? null : Number(row.chainId), verificationUrl: verificationUrl(row.id) };
  };
  const mustFind = async (repo, id) => {
    const row = await repo.find(certificateId(id));
    if (!row) throw new ApiError(404, "Certificate not found");
    return row;
  };
  const assertNetwork = (row, client) => {
    if (row.chainId != null && (Number(row.chainId) !== client.chainId || !sameAddress(row.contractAddress, client.contractAddress))) {
      throw new ApiError(503, "This certificate belongs to another registry deployment. Restore its configured network before retrying.");
    }
  };
  const reconcile = async (repo, row, state) => {
    if (!state.exists) return row;
    if (!sameAddress(row.recipientAddress, state.recipientAddress) || row.metadataCid !== state.metadataCid) {
      throw new ApiError(409, "The on-chain certificate does not match this record");
    }
    return repo.update(row.id, {
      status: state.valid ? "issued" : "revoked", issuerAddress: state.issuerAddress,
      issuedAt: state.issuedAt, revokedAt: state.revokedAt, error: null,
    });
  };
  const issue = async (repo, row) => {
    let client;
    try {
      client = await chain.connect(true);
      assertNetwork(row, client);
      let state = await client.verify(row.id);
      if (state.exists) return publicRow(await reconcile(repo, row, state));
      if (row.status === "issued" || row.status === "revoked") {
        throw new ApiError(503, "Previously issued certificate is missing from the chain. Restore the original network.");
      }
      if (row.transactionHash) {
        const receipt = await client.receipt(row.transactionHash);
        if (!receipt) return publicRow(await repo.update(row.id, { status: "pending", error: "Transaction is awaiting confirmation. Retry to check its status." }));
        if (receipt.success) throw new Error("Confirmed transaction has no matching certificate");
        row = await repo.update(row.id, { transactionHash: null, status: "failed" });
      }
      if (!row.metadataCid) row = await repo.update(row.id, { metadataCid: await ipfs.upload(metadataFor(row)) });
      row = await repo.update(row.id, { status: "pending", error: null,
        chainId: client.chainId, contractAddress: client.contractAddress, issuerAddress: client.issuerAddress });
      const hash = await client.issue(row.id, row.recipientAddress, row.metadataCid);
      // Persist before waiting so a restart or timeout can recover this exact ID.
      row = await repo.update(row.id, { transactionHash: hash });
      const receipt = await client.receipt(hash, true);
      if (!receipt) return publicRow(await repo.update(row.id, { error: "Transaction is awaiting confirmation. Retry to check its status." }));
      if (!receipt.success) {
        return publicRow(await repo.update(row.id, { status: "failed", transactionHash: null,
          error: "Certificate transaction reverted. Correct the issuer configuration and retry." }));
      }
      state = await client.verify(row.id);
      if (!state.exists) throw new Error("Confirmed transaction has no matching certificate");
      return publicRow(await reconcile(repo, row, state));
    } catch (error) {
      // Do not expose provider messages, RPC credentials or private keys.
      const message = error instanceof ApiError ? error.message : "Certificate service is unavailable. Check the network and IPFS, then retry this certificate.";
      const status = ["issued", "revoked"].includes(row.status) ? row.status : row.transactionHash ? "pending" : "failed";
      return publicRow(await repo.update(row.id, { status, error: message }));
    }
  };

  return {
    async config() {
      try {
        const client = await chain.connect(true);
        return { available: true, chainId: client.chainId, contractAddress: client.contractAddress,
          issuerAddress: client.issuerAddress, chainName: client.chainName, rpcUrl: client.rpcUrl, demoMode: client.demoMode };
      } catch (_error) {
        return { available: false, chainId: 0, contractAddress: "", issuerAddress: "", chainName: "Unavailable",
          rpcUrl: env.CERTIFICATE_PUBLIC_RPC_URL || (env.NODE_ENV === "production" ? null : "http://localhost:8545"), demoMode: env.CERTIFICATE_DEMO_MODE === "true",
          error: "Certificate service is not ready. Check the registry deployment, issuer configuration and RPC." };
      }
    },
    async list(user, filter) {
      let studentId = filter === undefined ? undefined : positiveId(filter);
      if (Number(user.roleId) === 3) {
        if (studentId && studentId !== Number(user.id)) throw new ApiError(403, "You can only view your own certificates");
        studentId = Number(user.id);
      } else requireAdmin(user);
      return (await repository.list(studentId)).map(publicRow);
    },
    async get(user, id) {
      const row = await mustFind(repository, id);
      if (Number(user.roleId) !== 1 && !(Number(user.roleId) === 3 && Number(row.studentId) === Number(user.id))) {
        throw new ApiError(403, "You can only view your own certificates");
      }
      return publicRow(row);
    },
    async create(user, input, key) {
      requireAdmin(user);
      const payload = validateInput(input);
      if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,120}$/.test(key))) {
        throw new ApiError(400, "Idempotency-Key must contain 8 to 120 letters, numbers, dots, underscores, colons or hyphens");
      }
      return repository.withMutationLock(async (repo) => {
        const requestKey = key ? `${user.id}:${key}` : null;
        let row = requestKey ? await repo.findByRequestKey(requestKey) : undefined;
        if (row) {
          if (row.studentId !== payload.studentId || row.title !== payload.title || row.description !== payload.description
              || !sameAddress(row.recipientAddress, payload.recipientAddress)) throw new ApiError(409, "This Idempotency-Key was already used for a different certificate");
          return issue(repo, row);
        }
        const student = await repo.findStudent(payload.studentId);
        if (!student) throw new ApiError(404, "Student not found");
        row = await repo.insert({ ...payload, id: `0x${randomBytes(32).toString("hex")}`, requestKey, createdBy: user.id });
        if (!row) throw new ApiError(404, "Student no longer exists");
        return issue(repo, row);
      });
    },
    async retry(user, id) {
      requireAdmin(user);
      return repository.withMutationLock(async (repo) => issue(repo, await mustFind(repo, id)));
    },
    async revoke(user, id) {
      requireAdmin(user);
      return repository.withMutationLock(async (repo) => {
        let row = await mustFind(repo, id);
        try {
          const client = await chain.connect(true, false);
          assertNetwork(row, client);
          let state = await client.verify(row.id);
          if (!state.exists) throw new ApiError(409, "This certificate has not been issued on the configured network");
          row = await reconcile(repo, row, state);
          if (!state.valid) return publicRow(row);
          if (row.revocationTransactionHash) {
            const previous = await client.receipt(row.revocationTransactionHash);
            if (!previous) return publicRow(await repo.update(row.id, { error: "Revocation is awaiting confirmation. Retry revocation to check its status." }));
            if (!previous.success) row = await repo.update(row.id, { revocationTransactionHash: null });
          }
          const hash = await client.revoke(row.id);
          row = await repo.update(row.id, { revocationTransactionHash: hash, error: null });
          const receipt = await client.receipt(hash, true);
          if (!receipt) return publicRow(await repo.update(row.id, { error: "Revocation is awaiting confirmation. Retry revocation to check its status." }));
          if (!receipt.success) return publicRow(await repo.update(row.id, { revocationTransactionHash: null, error: "Revocation reverted. Check the issuer and try again." }));
          state = await client.verify(row.id);
          if (state.valid) throw new Error("Revocation has not been confirmed");
          return publicRow(await reconcile(repo, row, state));
        } catch (error) {
          if (error instanceof ApiError && error.statusCode < 500) throw error;
          return publicRow(await repo.update(row.id, { error: "Revocation could not be confirmed. Retry revocation to recover its status." }));
        }
      });
    },
    async verify(id) {
      id = certificateId(id);
      try {
        const client = await chain.connect(false);
        const row = await repository.find(id);
        if (row) assertNetwork(row, client);
        const state = await client.verify(id);
        if (!state.exists && row && ["issued", "revoked"].includes(row.status)) {
          throw new ApiError(503, "This previously issued certificate is missing from the configured chain. Restore the original network before verifying it.");
        }
        const base = { id, exists: state.exists, valid: false, chainId: client.chainId,
          contractAddress: client.contractAddress, verificationUrl: verificationUrl(id) };
        if (!state.exists) return { ...base, status: "not_found" };
        const metadata = await ipfs.read(state.metadataCid);
        const matches = row && metadataMatches(row, state, metadata);
        const metadataUrl = `${(env.IPFS_GATEWAY_URL || "http://localhost:5173/ipfs").replace(/\/$/, "")}/${encodeURIComponent(state.metadataCid)}`;
        return { ...base, valid: Boolean(state.valid && matches), status: !matches ? "invalid" : state.valid ? "issued" : "revoked",
          issuerAddress: state.issuerAddress, recipientAddress: state.recipientAddress, metadataCid: state.metadataCid,
          title: row?.title || "Unrecognized certificate", description: row?.description || "",
          issuedAt: state.issuedAt, revokedAt: state.revokedAt, transactionHash: row?.transactionHash || null,
          metadataUrl };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, "Verification is temporarily unavailable. The network or IPFS could not be reached; try again later.");
      }
    },
  };
}

module.exports = { createCertificateService, validateInput, certificateId, metadataFor, metadataMatches };
