-- Avatar https của người gửi Zalo. Ứng dụng không sao chép ảnh sang R2.

ALTER TABLE conversation ADD COLUMN avatar_url TEXT;
ALTER TABLE conversation ADD COLUMN avatar_checked_at TEXT;
ALTER TABLE zalo_group_member ADD COLUMN avatar_url TEXT;
