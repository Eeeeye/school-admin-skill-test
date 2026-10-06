// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Stores the verifiable part of a certificate on-chain.
 * The certificate document itself stays off-chain; metadataCid points to an
 * IPFS JSON document containing the title, recipient details and document hash.
 */
contract CertificateRegistry {
    uint256 public constant MAX_METADATA_CID_LENGTH = 256;

    struct Certificate {
        address issuer;
        address recipient;
        string metadataCid;
        uint64 issuedAt;
        uint64 revokedAt;
    }

    address public owner;
    address public pendingOwner;
    mapping(address => bool) public issuers;
    mapping(bytes32 => Certificate) private certificates;

    error Unauthorized();
    error InvalidCertificateId();
    error InvalidRecipient();
    error InvalidMetadataCid();
    error MetadataCidTooLong();
    error CertificateAlreadyExists();
    error CertificateNotFound();
    error CertificateAlreadyRevoked();
    error NoPendingOwnershipTransfer();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferCancelled(address indexed owner);
    event IssuerUpdated(address indexed issuer, bool allowed);
    event CertificateIssued(
        bytes32 indexed certificateId,
        address indexed issuer,
        address indexed recipient,
        string metadataCid
    );
    event CertificateRevoked(bytes32 indexed certificateId, address indexed revoker);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyIssuer() {
        if (!issuers[msg.sender]) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
        issuers[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit IssuerUpdated(msg.sender, true);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidRecipient();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    function cancelOwnershipTransfer() external onlyOwner {
        if (pendingOwner == address(0)) revert NoPendingOwnershipTransfer();
        pendingOwner = address(0);
        emit OwnershipTransferCancelled(owner);
    }

    function setIssuer(address issuer, bool allowed) external onlyOwner {
        if (issuer == address(0)) revert InvalidRecipient();
        issuers[issuer] = allowed;
        emit IssuerUpdated(issuer, allowed);
    }

    function issueCertificate(
        bytes32 certificateId,
        address recipient,
        string calldata metadataCid
    ) external onlyIssuer {
        if (certificateId == bytes32(0)) revert InvalidCertificateId();
        if (recipient == address(0)) revert InvalidRecipient();
        uint256 metadataCidLength = bytes(metadataCid).length;
        if (metadataCidLength == 0) revert InvalidMetadataCid();
        if (metadataCidLength > MAX_METADATA_CID_LENGTH) revert MetadataCidTooLong();
        if (certificates[certificateId].issuedAt != 0) revert CertificateAlreadyExists();

        certificates[certificateId] = Certificate({
            issuer: msg.sender,
            recipient: recipient,
            metadataCid: metadataCid,
            issuedAt: uint64(block.timestamp),
            revokedAt: 0
        });

        emit CertificateIssued(certificateId, msg.sender, recipient, metadataCid);
    }

    function revokeCertificate(bytes32 certificateId) external {
        Certificate storage certificate = certificates[certificateId];
        if (certificate.issuedAt == 0) revert CertificateNotFound();
        if (msg.sender != certificate.issuer && msg.sender != owner) revert Unauthorized();
        if (certificate.revokedAt != 0) revert CertificateAlreadyRevoked();

        certificate.revokedAt = uint64(block.timestamp);
        emit CertificateRevoked(certificateId, msg.sender);
    }

    function verifyCertificate(bytes32 certificateId)
        external
        view
        returns (
            bool exists,
            bool valid,
            address issuer,
            address recipient,
            string memory metadataCid,
            uint64 issuedAt,
            uint64 revokedAt
        )
    {
        Certificate memory certificate = certificates[certificateId];
        exists = certificate.issuedAt != 0;
        valid = exists && certificate.revokedAt == 0;
        issuer = certificate.issuer;
        recipient = certificate.recipient;
        metadataCid = certificate.metadataCid;
        issuedAt = certificate.issuedAt;
        revokedAt = certificate.revokedAt;
    }
}
