-- 1. registering a device on first open. we need this so the database actually has a physical anchor (the device_id) to link the websocket connection to later.
INSERT INTO Devices (device_id, device_name, os_type) 
VALUES ('dev_123', 'Merub-iPhone', 'iOS');

-- 2. fetching device details on startup. this lets the frontend know if it needs to prompt the user to rename their device or if they are already set up.
SELECT * FROM Devices WHERE device_id = 'dev_123';

-- 3. logging a safe wifi zone. this is for the proximity check. if two devices share this exact bssid, we know they are in the same physical room.
INSERT INTO Network_Zones (zone_id, wifi_ssid, bssid) 
VALUES ('zone_01', 'Internship_Guest_5G', '00:14:22:01:23:45');

-- 4. generating the 6-digit handshake pin. using the datetime function to set the expiration strictly to 5 minutes from now so nobody can guess it later.
INSERT INTO Security_Keys (key_id, pin_code, expires_at) 
VALUES ('key_99', '849201', datetime('now', '+5 minutes'));

-- 5. validating the pin. when the laptop types the pin shown on the phone, this query checks if it exists AND ensures it hasn't expired yet.
SELECT * FROM Security_Keys 
WHERE pin_code = '849201' AND expires_at > CURRENT_TIMESTAMP;

-- 6. creating the live websocket tunnel. this links the sender (phone) and receiver (laptop) together in the database before the file even starts moving.
INSERT INTO Active_Sessions (session_id, sender_device_id, receiver_device_id, status) 
VALUES ('sess_55', 'dev_123', 'dev_456', 'CONNECTED');

-- 7. dropping the session. this runs the literal millisecond the file finishes dropping across the screen, or if the user swipes the app away.
UPDATE Active_Sessions SET status = 'DROPPED' WHERE session_id = 'sess_55';

-- 8. tracking the file metadata. this does not store the file itself (the actual file goes purely through the websocket), it just logs the receipt of what was sent.
INSERT INTO Files_Metadata (file_id, session_id, file_name, file_size_mb, file_type) 
VALUES ('file_77', 'sess_55', 'presentation.pdf', 14.5, '.pdf');

-- 9. manual killswitch. if the websocket crashes or bugs out, we run this to physically destroy the session row so it doesn't get stuck.
DELETE FROM Active_Sessions WHERE session_id = 'sess_55';

-- 10. the garbage collector. this runs in the background to wipe dead pins so our database doesn't fill up with trash and become a security risk.
DELETE FROM Security_Keys WHERE expires_at < CURRENT_TIMESTAMP;

-- 11. getting all files dropped by a specific phone. we join the devices, sessions, and files tables to trace the file metadata back to the original sender.
SELECT d.device_name, f.file_name, f.file_size_mb 
FROM Devices d
JOIN Active_Sessions s ON d.device_id = s.sender_device_id
JOIN Files_Metadata f ON s.session_id = f.session_id
WHERE d.device_id = 'dev_123';

-- 12. calculating total mb dropped based on os type. this groups the data so we can see if ios or windows devices are transferring heavier files.
SELECT d.os_type, SUM(f.file_size_mb) AS total_megabytes_dropped
FROM Devices d
JOIN Active_Sessions s ON d.device_id = s.sender_device_id
JOIN Files_Metadata f ON s.session_id = f.session_id
GROUP BY d.os_type;

-- 13. figuring out which wifi networks have the most traffic. this joins networks to devices to sessions to find the most active hot zones.
SELECT n.wifi_ssid, COUNT(s.session_id) as total_drops
FROM Network_Zones n
JOIN Devices d ON n.zone_id = d.last_known_zone_id
JOIN Active_Sessions s ON d.device_id = s.sender_device_id
GROUP BY n.wifi_ssid
ORDER BY total_drops DESC;

-- 14. finding ghost sessions. this looks for connections that got stuck on "PENDING" for over an hour so the server can kill them.
SELECT session_id, connected_at 
FROM Active_Sessions 
WHERE status = 'PENDING' AND connected_at < datetime('now', '-1 hour');

-- 15. daily success rate. this counts how many drops actually worked today vs failed, grouped by the success flag from the analytics log.
SELECT success_flag, COUNT(*) as transfer_count
FROM Transfer_Logs
WHERE date(timestamp) = date('now')
GROUP BY success_flag;

-- 16. finding the biggest file ever dropped. using a subquery here to isolate the absolute maximum file size in the metadata table.
SELECT file_name, file_size_mb 
FROM Files_Metadata 
WHERE file_size_mb = (SELECT MAX(file_size_mb) FROM Files_Metadata);

-- 17. seeing which two devices pair up the most. this groups sender and receiver pairs and counts them to see who is constantly dropping files to each other.
SELECT sender_device_id, receiver_device_id, COUNT(*) as connection_count
FROM Active_Sessions
GROUP BY sender_device_id, receiver_device_id
ORDER BY connection_count DESC
LIMIT 5;

-- 18. security audit check. this uses a LEFT JOIN to find pins that were generated but never actually linked to an active session (abandoned drops).
SELECT k.pin_code, k.expires_at
FROM Security_Keys k
LEFT JOIN Active_Sessions s ON k.session_id = s.session_id
WHERE s.session_id IS NULL;

-- 19. analyzing ios network speeds. we join logs to sessions to devices to average out the mbps strictly for iphones to see if they lag.
SELECT AVG(t.transfer_speed_mbps) as avg_ios_speed
FROM Transfer_Logs t
JOIN Active_Sessions s ON t.session_id = s.session_id
JOIN Devices d ON s.sender_device_id = d.device_id
WHERE d.os_type = 'iOS';

-- 20. testing nuke. wiping all the temporary spatial data so we can test the whole drop process from a completely blank slate.
DELETE FROM Active_Sessions;
DELETE FROM Security_Keys;
DELETE FROM Files_Metadata;