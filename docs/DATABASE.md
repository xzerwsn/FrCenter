# Схема базы данных

Основная база: PostgreSQL. Для TTL сообщений дополнительно используется Redis или фоновая очистка по `expires_at`.

## users

```text
id UUID PK
email TEXT UNIQUE
username TEXT UNIQUE
password_hash TEXT
cloud_password_hash TEXT
is_email_confirmed BOOLEAN
avatar_url TEXT NULL
status TEXT
current_game TEXT NULL
created_at TIMESTAMP
updated_at TIMESTAMP
```

## email_confirmations

```text
id UUID PK
user_id UUID FK users.id
code_hash TEXT
expires_at TIMESTAMP
used_at TIMESTAMP NULL
created_at TIMESTAMP
```

## devices

```text
id UUID PK
user_id UUID FK users.id
device_name TEXT
public_key TEXT
encrypted_private_key TEXT
last_seen_at TIMESTAMP
created_at TIMESTAMP
```

## friend_requests

```text
id UUID PK
from_user_id UUID FK users.id
to_user_id UUID FK users.id
status TEXT
created_at TIMESTAMP
updated_at TIMESTAMP
```

## friendships

```text
id UUID PK
user_a_id UUID FK users.id
user_b_id UUID FK users.id
created_at TIMESTAMP
```

## invite_codes

```text
id UUID PK
owner_id UUID FK users.id
code TEXT UNIQUE
max_uses INTEGER
used_count INTEGER
expires_at TIMESTAMP NULL
created_at TIMESTAMP
```

## chats

```text
id UUID PK
type TEXT
title TEXT NULL
avatar_url TEXT NULL
created_by UUID FK users.id
created_at TIMESTAMP
updated_at TIMESTAMP
```

## chat_members

```text
id UUID PK
chat_id UUID FK chats.id
user_id UUID FK users.id
role TEXT
encrypted_group_key TEXT NULL
joined_at TIMESTAMP
left_at TIMESTAMP NULL
```

## messages

```text
id UUID PK
chat_id UUID FK chats.id
sender_id UUID FK users.id
ciphertext TEXT
nonce TEXT
message_type TEXT
expires_at TIMESTAMP
created_at TIMESTAMP
```

## message_recipients

```text
id UUID PK
message_id UUID FK messages.id
recipient_user_id UUID FK users.id
encrypted_message_key TEXT
delivery_status TEXT
read_at TIMESTAMP NULL
created_at TIMESTAMP
```

## media_files

```text
id UUID PK
owner_id UUID FK users.id
message_id UUID FK messages.id NULL
file_name TEXT
mime_type TEXT
size_bytes INTEGER
storage_path TEXT
is_encrypted BOOLEAN
created_at TIMESTAMP
expires_at TIMESTAMP NULL
```

## feed_posts

```text
id UUID PK
author_id UUID FK users.id
text TEXT
media_id UUID FK media_files.id NULL
visibility TEXT
created_at TIMESTAMP
updated_at TIMESTAMP
```

## feed_comments

```text
id UUID PK
post_id UUID FK feed_posts.id
author_id UUID FK users.id
text TEXT
created_at TIMESTAMP
updated_at TIMESTAMP
```

## feed_reactions

```text
id UUID PK
post_id UUID FK feed_posts.id
user_id UUID FK users.id
reaction TEXT
created_at TIMESTAMP
```

## game_accounts

```text
id UUID PK
user_id UUID FK users.id
platform TEXT
external_user_id TEXT
display_name TEXT
access_token_encrypted TEXT NULL
refresh_token_encrypted TEXT NULL
created_at TIMESTAMP
updated_at TIMESTAMP
```

## game_activities

```text
id UUID PK
user_id UUID FK users.id
platform TEXT
game_name TEXT
activity_type TEXT
payload_json JSONB
created_at TIMESTAMP
```
