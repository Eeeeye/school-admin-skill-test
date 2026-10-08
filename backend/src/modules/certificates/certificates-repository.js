const { db } = require("../../config");

const columns = `id, student_id AS "studentId", student_name AS "studentName",
  title, description, recipient_address AS "recipientAddress",
  metadata_cid AS "metadataCid", transaction_hash AS "transactionHash",
  revocation_transaction_hash AS "revocationTransactionHash",
  chain_id AS "chainId", contract_address AS "contractAddress",
  issuer_address AS "issuerAddress", status, error,
  created_at AS "createdAt", issued_at AS "issuedAt", revoked_at AS "revokedAt"`;

function createRepository(client = db) {
  return {
    async findStudent(id) {
      const { rows } = await client.query("SELECT id, name FROM users WHERE id = $1 AND role_id = 3", [id]);
      return rows[0];
    },
    async list(studentId) {
      const { rows } = await client.query(`SELECT ${columns} FROM student_certificates
        ${studentId ? "WHERE student_id = $1" : ""} ORDER BY created_at DESC LIMIT 500`, studentId ? [studentId] : []);
      return rows;
    },
    async find(id) {
      const { rows } = await client.query(`SELECT ${columns} FROM student_certificates WHERE id = $1`, [id]);
      return rows[0];
    },
    async findByRequestKey(key) {
      const { rows } = await client.query(`SELECT ${columns} FROM student_certificates WHERE request_key = $1`, [key]);
      return rows[0];
    },
    async insert(data) {
      const { rows } = await client.query(`INSERT INTO student_certificates
        (id, student_id, student_name, title, description, recipient_address, request_key, created_by)
        SELECT $1, u.id, u.name, $3, $4, $5, $6, $7 FROM users u WHERE u.id = $2 AND u.role_id = 3
        RETURNING ${columns}`, [data.id, data.studentId, data.title, data.description,
        data.recipientAddress, data.requestKey, data.createdBy]);
      return rows[0];
    },
    async update(id, changes) {
      const allowed = {
        metadataCid: "metadata_cid", transactionHash: "transaction_hash",
        revocationTransactionHash: "revocation_transaction_hash", chainId: "chain_id",
        contractAddress: "contract_address", issuerAddress: "issuer_address", status: "status",
        error: "error", issuedAt: "issued_at", revokedAt: "revoked_at",
      };
      const fields = Object.entries(changes).filter(([key]) => allowed[key]);
      if (!fields.length) return this.find(id);
      const { rows } = await client.query(`UPDATE student_certificates SET
        ${fields.map(([key], i) => `${allowed[key]} = $${i + 2}`).join(", ")}
        WHERE id = $1 RETURNING ${columns}`, [id, ...fields.map(([, value]) => value)]);
      return rows[0];
    },
    async withMutationLock(operation) {
      const connection = await db.connect();
      let acquired = false;
      try {
        // One issuer is shared by all web instances. A PostgreSQL lock serializes
        // its nonce and certificate recovery across processes, not just requests.
        const { rows } = await connection.query("SELECT pg_try_advisory_lock(732941, 1) AS acquired");
        acquired = rows[0].acquired;
        if (!acquired) {
          const { ApiError } = require("../../utils/api-error");
          throw new ApiError(409, "Another certificate transaction is in progress. Please retry shortly.");
        }
        return await operation(createRepository(connection));
      } finally {
        let releaseError;
        if (acquired) {
          try { await connection.query("SELECT pg_advisory_unlock(732941, 1)"); }
          catch (error) { releaseError = error; }
        }
        // Session locks survive pool checkout. If cleanup fails, close this
        // connection so it cannot indefinitely block the other pool clients.
        connection.release(releaseError);
      }
    },
  };
}

module.exports = { createRepository };
