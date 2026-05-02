const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS outbound_emails (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      recipient_email VARCHAR(190) NOT NULL,
      subject VARCHAR(190) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      metadata JSON NULL,
      payload JSON NULL,
      provider_response JSON NULL,
      sent_at DATETIME NULL,
      failed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_outbound_emails_recipient_email (recipient_email),
      KEY idx_outbound_emails_status (status)
    )
  `
  ,
  `
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      store_id BIGINT UNSIGNED NOT NULL,
      frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      last_sent_at DATETIME NULL,
      next_send_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_marketing_campaigns_store_id (store_id),
      KEY idx_marketing_campaigns_due (status, next_send_at)
    )
  `
];

module.exports = {
  schemaStatements
};
