const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS kyc_profiles (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_id BIGINT UNSIGNED NOT NULL,
      first_name VARCHAR(120) NOT NULL,
      last_name VARCHAR(120) NOT NULL,
      bvn VARCHAR(60) NULL,
      country VARCHAR(80) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      metadata JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_kyc_owner_id (owner_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS kyb_profiles (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_id BIGINT UNSIGNED NOT NULL,
      store_id BIGINT UNSIGNED NULL,
      business_name VARCHAR(180) NOT NULL,
      registration_number VARCHAR(120) NULL,
      country VARCHAR(80) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      metadata JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_kyb_owner_id (owner_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS compliance_documents (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_id BIGINT UNSIGNED NOT NULL,
      store_id BIGINT UNSIGNED NULL,
      profile_type VARCHAR(20) NOT NULL,
      profile_id BIGINT UNSIGNED NOT NULL,
      document_type VARCHAR(80) NOT NULL,
      file_url VARCHAR(255) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'uploaded',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_compliance_documents_owner (owner_id),
      KEY idx_compliance_documents_profile (profile_type, profile_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS compliance_reviews (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      owner_id BIGINT UNSIGNED NOT NULL,
      store_id BIGINT UNSIGNED NULL,
      target_type VARCHAR(20) NOT NULL,
      target_id BIGINT UNSIGNED NOT NULL,
      reviewer_user_id BIGINT UNSIGNED NOT NULL,
      reviewer_role VARCHAR(40) NOT NULL,
      status VARCHAR(40) NOT NULL,
      note TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_compliance_reviews_owner (owner_id),
      KEY idx_compliance_reviews_target (target_type, target_id)
    )
  `
];

module.exports = {
  schemaStatements
};
