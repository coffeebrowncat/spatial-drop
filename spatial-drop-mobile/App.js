import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Animated,
  StyleSheet,
  SafeAreaView,
  Alert,
  Keyboard,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

// paste the SAME firebase database url used in server.js / index.html
const FIREBASE_DB_URL = 'https://spatial-drop-default-rtdb.firebaseio.com';

const COLORS = {
  bg: '#0e0a09',
  boxBorder: '#3a221c',
  boxBorderFilled: '#f0c98a',
  digit: '#f5e6c8',
  digitEmpty: '#6b5040',
  you: '#f5e6c8',
  amber: '#f0c98a',   // sending
  wine: '#7a2e2e',    // receiving
  idle: '#5a463a',    // connected, nothing happening yet
  caption: '#6b5040',
  error: '#b34a3a',
};

// no external uuid lib needed — this is just for telling devices
// apart within a room, not cryptographic
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function App() {
  // stage: 'intro' -> 'boarding' -> 'dock' -> 'radar'
  const [stage, setStage] = useState('intro');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [connectError, setConnectError] = useState(null);
  const [peers, setPeers] = useState([]);
  const [status, setStatus] = useState('flick up to drop');
  const [debugMsg, setDebugMsg] = useState(''); // NEW — visible debug trail

  const debugLog = (msg) => {
    console.log(msg); // still shows in the `expo start` terminal too
    setDebugMsg(String(msg));
  };

  const deviceIdRef = useRef(generateId());
  const wsRef = useRef(null);
  const hostIpRef = useRef(null);
  const pinInputRef = useRef(null);

  const canvasOpacity = useRef(new Animated.Value(1)).current;

  const crossfadeTo = (nextStage) => {
    Animated.sequence([
      Animated.timing(canvasOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      setStage(nextStage);
      Animated.timing(canvasOpacity, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    });
  };

  // ---------- networking ----------

  const resolveIp = async (roomPin) => {
    try {
      const url = `${FIREBASE_DB_URL}/pins/${roomPin}.json`;
      debugLog(`fetching ${url}`);

      const res = await fetch(url);
      debugLog(`firebase status ${res.status}`);

      const data = await res.json();
      debugLog(`firebase data: ${JSON.stringify(data)}`);

      if (!data || !data.ip) return null;
      return data.ip;
    } catch (err) {
      debugLog(`FIREBASE FETCH ERROR: ${err.message}`);
      return null;
    }
  };
  const handleIncoming = (data) => {
    if (data.error) {
      // the server sends { error: '...' } with no "type" field for
      // things like a full room — this had no handler before, so it
      // failed completely silently
      debugLog(`server error: ${data.error}`);
      setConnectError(data.error);
      return;
    }

    if (data.type === 'room_update') {
      setPeers(data.peers.filter((p) => p.deviceId !== deviceIdRef.current));
      if (stage !== 'radar') {
        Keyboard.dismiss();
        pinInputRef.current?.blur();
        crossfadeTo('radar');
      }
      return;
    }

    if (data.type === 'incoming_files') {
      if (data.trusted) {
        wsRef.current.send(JSON.stringify({ type: 'accept_transfer', transferId: data.transferId }));
        return;
      }
      Alert.alert(
        data.count > 1 ? `${data.count} files incoming` : 'a file is incoming',
        data.fileNames.join('\n'),
        [
          {
            text: 'decline',
            style: 'cancel',
            onPress: () =>
              wsRef.current.send(JSON.stringify({ type: 'decline_transfer', transferId: data.transferId })),
          },
          {
            text: 'accept',
            onPress: () =>
              wsRef.current.send(JSON.stringify({ type: 'accept_transfer', transferId: data.transferId })),
          },
        ]
      );
      return;
    }

    if (data.type === 'file_caught') {
      setStatus('they caught it');
      setTimeout(() => setStatus('flick up to drop'), 2500);
      return;
    }

    if (data.type === 'transfer_declined') {
      setStatus('declined');
      setTimeout(() => setStatus('flick up to drop'), 2500);
    }
  };

  const connectToRoom = async (roomPin) => {
    setConnectError(null);
    debugLog('resolving ip...');
    const ip = await resolveIp(roomPin);
    if (!ip) {
      setConnectError('pin not found — check it and try again');
      debugLog('no ip found for this pin');
      return;
    }
    hostIpRef.current = ip;
    debugLog(`opening ws://${ip}:3000`);

    const socket = new WebSocket(`ws://${ip}:3000`);
    wsRef.current = socket;

    socket.onopen = () => {
      debugLog('websocket opened, sending join');
      socket.send(
        JSON.stringify({
          type: 'join',
          pin: roomPin,
          role: 'mobile',
          deviceId: deviceIdRef.current,
          label: name || 'phone',
        })
      );
    };

    socket.onmessage = (event) => {
      debugLog(`ws message: ${event.data}`);
      try {
        handleIncoming(JSON.parse(event.data));
      } catch (e) {
        debugLog(`could not parse message: ${e.message}`);
      }
    };

    socket.onerror = (err) => {
      debugLog('WEBSOCKET ERROR');
      setConnectError('connection failed — is the laptop on the same wifi?');
    };

    // NEW — this handler didn't exist before. if the connection drops
    // or never fully opens, this is the only way you'd know.
    socket.onclose = (event) => {
      debugLog(`ws closed. code: ${event.code}, reason: "${event.reason}"`);
    };
  };

  const handlePinChange = (text) => {
    const digitsOnly = text.replace(/[^0-9]/g, '').slice(0, 6);
    setPin(digitsOnly);
    if (digitsOnly.length === 6) connectToRoom(digitsOnly);
  };

  // ---------- sending ----------
  // temporary tap-to-send button — Day 5 replaces this trigger with
  // the real swipe gesture. the networking underneath doesn't change.

  const pickAndSend = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;

    const formData = new FormData();
    result.assets.forEach((f) => {
      formData.append('files', {
        uri: f.uri,
        name: f.name,
        type: f.mimeType || 'application/octet-stream',
      });
    });
    formData.append('roomId', pin);
    formData.append('deviceId', deviceIdRef.current);

    setStatus('sending...');
    try {
      const res = await fetch(`http://${hostIpRef.current}:3000/api/upload`, {
        method: 'POST',
        body: formData,
      });
      setStatus(res.ok ? 'sent — waiting for them to accept' : 'send failed');
    } catch (err) {
      setStatus('send failed');
    }
  };

  // ---------- render ----------

  const digitBoxes = Array.from({ length: 6 }, (_, i) => pin[i] ?? null);

  return (
    <SafeAreaView style={styles.safe}>
      <TextInput
        ref={pinInputRef}
        value={pin}
        onChangeText={handlePinChange}
        keyboardType="number-pad"
        maxLength={6}
        style={styles.hiddenInput}
      />

      <Animated.View style={[styles.canvas, { opacity: canvasOpacity }]}>
        {stage === 'intro' && (
          <View style={styles.centerBlock}>
            <Text style={styles.title}>spatialDROP.</Text>
            <Text style={styles.introLine}>install the app on ios or android</Text>
            <Text style={styles.introLine}>install the companion app on your laptop</Text>
            <Text style={styles.introLine}>sync the two with the code shown on the laptop</Text>
            <Pressable style={styles.ctaButton} onPress={() => crossfadeTo('boarding')}>
              <Text style={styles.ctaText}>skip instructions</Text>
            </Pressable>
          </View>
        )}

        {stage === 'boarding' && (
          <View style={styles.centerBlock}>
            <Text style={styles.title}>create boarding pass</Text>
            <TextInput
              placeholder="name"
              placeholderTextColor={COLORS.digitEmpty}
              value={name}
              onChangeText={setName}
              style={styles.nameInput}
            />
            <Text style={styles.idLine}>id: {deviceIdRef.current.slice(0, 8)}</Text>
            <Pressable style={styles.ctaButton} onPress={() => crossfadeTo('dock')}>
              <Text style={styles.ctaText}>continue</Text>
            </Pressable>
          </View>
        )}

        {stage === 'dock' && (
          <Pressable style={styles.centerBlock} onPress={() => pinInputRef.current?.focus()}>
            <Text style={styles.label}>welcome aboard. enter dock</Text>
            <View style={styles.pinRow}>
              {digitBoxes.map((d, i) => (
                <View
                  key={i}
                  style={[
                    styles.pinBox,
                    { borderColor: d ? COLORS.boxBorderFilled : COLORS.boxBorder },
                  ]}
                >
                  <Text style={[styles.pinDigit, { color: d ? COLORS.digit : COLORS.digitEmpty }]}>
                    {d ?? '_'}
                  </Text>
                </View>
              ))}
            </View>
            {connectError && <Text style={styles.errorText}>{connectError}</Text>}
            {debugMsg ? <Text style={styles.debugText}>{debugMsg}</Text> : null}
          </Pressable>
        )}

        {stage === 'radar' && (
          <View style={styles.centerBlock}>
            <View style={styles.radarField}>
              {peers.map((peer, i) => {
                const angle = (i / Math.max(peers.length, 1)) * Math.PI * 2;
                const x = Math.cos(angle) * 90;
                const y = Math.sin(angle) * 90;
                return (
                  <View key={peer.deviceId} style={[styles.peer, { transform: [{ translateX: x }, { translateY: y }] }]}>
                    <View style={[styles.peerDot, { backgroundColor: COLORS.idle }]} />
                    <Text style={styles.peerLabel}>{peer.label}</Text>
                  </View>
                );
              })}
              <View style={styles.youDot} />
            </View>
            <Text style={styles.caption}>{status}</Text>
            <Pressable style={styles.ctaButton} onPress={pickAndSend}>
              <Text style={styles.ctaText}>pick + send</Text>
            </Pressable>
          </View>
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  canvas: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerBlock: { alignItems: 'center', paddingHorizontal: 32 },
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1, top: -100 },

  title: { color: COLORS.digit, fontSize: 18, marginBottom: 20 },
  introLine: { color: COLORS.caption, fontSize: 12, marginBottom: 8, textAlign: 'center' },
  idLine: { color: COLORS.caption, fontSize: 11, marginTop: 10 },

  nameInput: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.boxBorder,
    color: COLORS.digit,
    width: 200,
    textAlign: 'center',
    paddingVertical: 8,
    marginTop: 10,
  },

  ctaButton: {
    marginTop: 26,
    borderWidth: 1,
    borderColor: COLORS.boxBorder,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  ctaText: { color: COLORS.digit, fontSize: 12, letterSpacing: 1 },

  label: { color: COLORS.caption, fontSize: 12, letterSpacing: 2, marginBottom: 18 },
  pinRow: { flexDirection: 'row', gap: 8 },
  pinBox: {
    width: 34, height: 42, borderWidth: 1, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  pinDigit: { fontSize: 16 },
  errorText: { color: COLORS.error, fontSize: 11, marginTop: 16, textAlign: 'center' },
  debugText: { color: '#666', fontSize: 9, marginTop: 20, textAlign: 'center', paddingHorizontal: 20 },

  radarField: { width: 260, height: 260, alignItems: 'center', justifyContent: 'center' },
  youDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.you },
  peer: { position: 'absolute', alignItems: 'center', gap: 6 },
  peerDot: { width: 13, height: 13, borderRadius: 7 },
  peerLabel: { fontSize: 10, color: COLORS.caption },
  caption: { marginTop: 24, fontSize: 10, letterSpacing: 1.5, color: COLORS.caption },
});