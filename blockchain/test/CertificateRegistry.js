const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CertificateRegistry", function () {
  async function deployed() {
    const [owner, recipient, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("CertificateRegistry");
    const registry = await Factory.deploy();
    await registry.waitForDeployment();
    return { registry, owner, recipient, other };
  }

  it("issues and verifies a certificate", async function () {
    const { registry, recipient } = await deployed();
    const id = ethers.id("certificate-001");

    await expect(registry.issueCertificate(id, recipient.address, "bafy-test-cid"))
      .to.emit(registry, "CertificateIssued");

    const result = await registry.verifyCertificate(id);
    expect(result.exists).to.equal(true);
    expect(result.valid).to.equal(true);
    expect(result.recipient).to.equal(recipient.address);
    expect(result.metadataCid).to.equal("bafy-test-cid");
  });

  it("rejects invalid certificate inputs", async function () {
    const { registry, recipient } = await deployed();

    await expect(registry.issueCertificate(ethers.ZeroHash, recipient.address, "cid"))
      .to.be.revertedWithCustomError(registry, "InvalidCertificateId");
    await expect(registry.issueCertificate(ethers.id("certificate-zero-recipient"), ethers.ZeroAddress, "cid"))
      .to.be.revertedWithCustomError(registry, "InvalidRecipient");
    await expect(registry.issueCertificate(ethers.id("certificate-empty-cid"), recipient.address, ""))
      .to.be.revertedWithCustomError(registry, "InvalidMetadataCid");

    const oversizedCid = "x".repeat(257);
    await expect(registry.issueCertificate(ethers.id("certificate-large-cid"), recipient.address, oversizedCid))
      .to.be.revertedWithCustomError(registry, "MetadataCidTooLong");
  });

  it("only allows approved issuers to issue certificates", async function () {
    const { registry, recipient, other } = await deployed();
    await expect(
      registry.connect(other).issueCertificate(ethers.id("certificate-002"), recipient.address, "cid")
    ).to.be.revertedWithCustomError(registry, "Unauthorized");
  });

  it("marks a certificate invalid after revocation", async function () {
    const { registry, recipient } = await deployed();
    const id = ethers.id("certificate-003");
    await registry.issueCertificate(id, recipient.address, "cid");
    await expect(registry.revokeCertificate(id)).to.emit(registry, "CertificateRevoked");

    const result = await registry.verifyCertificate(id);
    expect(result.exists).to.equal(true);
    expect(result.valid).to.equal(false);
    expect(result.revokedAt).to.be.greaterThan(0);
  });

  it("does not allow duplicate or unknown certificate transitions", async function () {
    const { registry, recipient } = await deployed();
    const id = ethers.id("certificate-duplicate");

    await registry.issueCertificate(id, recipient.address, "cid");
    await expect(registry.issueCertificate(id, recipient.address, "cid-2"))
      .to.be.revertedWithCustomError(registry, "CertificateAlreadyExists");
    await expect(registry.revokeCertificate(ethers.id("certificate-missing")))
      .to.be.revertedWithCustomError(registry, "CertificateNotFound");
    await registry.revokeCertificate(id);
    await expect(registry.revokeCertificate(id))
      .to.be.revertedWithCustomError(registry, "CertificateAlreadyRevoked");
  });

  it("does not let another issuer revoke someone else's certificate", async function () {
    const { registry, recipient, other } = await deployed();
    const id = ethers.id("certificate-004");
    await registry.setIssuer(other.address, true);
    await registry.issueCertificate(id, recipient.address, "cid");
    await expect(registry.connect(other).revokeCertificate(id))
      .to.be.revertedWithCustomError(registry, "Unauthorized");
    expect((await registry.verifyCertificate(id)).valid).to.equal(true);
  });

  it("allows a transferred owner to revoke a certificate", async function () {
    const { registry, owner, recipient, other } = await deployed();
    const id = ethers.id("certificate-005");
    await registry.issueCertificate(id, recipient.address, "cid");
    await registry.transferOwnership(other.address);

    expect(await registry.owner()).to.equal(owner.address);
    await expect(registry.connect(other).revokeCertificate(id))
      .to.be.revertedWithCustomError(registry, "Unauthorized");
    await registry.connect(other).acceptOwnership();
    await expect(registry.connect(other).revokeCertificate(id))
      .to.emit(registry, "CertificateRevoked");
    expect((await registry.verifyCertificate(id)).valid).to.equal(false);
  });

  it("supports cancelling a pending ownership transfer", async function () {
    const { registry, owner, other } = await deployed();

    await registry.transferOwnership(other.address);
    await expect(registry.cancelOwnershipTransfer())
      .to.emit(registry, "OwnershipTransferCancelled");
    await expect(registry.connect(other).acceptOwnership())
      .to.be.revertedWithCustomError(registry, "Unauthorized");
    expect(await registry.owner()).to.equal(owner.address);
  });

  it("allows the original issuer to revoke after issuer access is removed", async function () {
    const { registry, recipient, owner } = await deployed();
    const id = ethers.id("certificate-006");

    await registry.issueCertificate(id, recipient.address, "cid");
    await registry.setIssuer(owner.address, false);
    await expect(registry.revokeCertificate(id))
      .to.emit(registry, "CertificateRevoked");
    expect((await registry.verifyCertificate(id)).valid).to.equal(false);
  });
});
