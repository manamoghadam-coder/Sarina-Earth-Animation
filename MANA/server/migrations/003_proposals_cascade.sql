ALTER TABLE ai_proposals DROP CONSTRAINT ai_proposals_user_id_fkey, ADD CONSTRAINT ai_proposals_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE photos DROP CONSTRAINT photos_uploaded_by_fkey, ADD CONSTRAINT photos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE;
