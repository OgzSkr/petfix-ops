-- Şifreli kanal kimlik bilgileri (Faz 4a)
ALTER TABLE ops_branch_channel_config
  ADD COLUMN IF NOT EXISTS secrets_ciphertext TEXT;

COMMENT ON COLUMN ops_branch_channel_config.secrets_ciphertext IS
  'AES-256-GCM ile şifrelenmiş secret alanları (apiKey, apiSecret, clientSecret, vb.)';
