-- Remove the application-specific 10 MB cap. The project's global plan limit still applies.
update storage.buckets set file_size_limit = null where id = 'materials';
