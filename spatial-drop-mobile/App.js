import 'react-native-gesture-handler'; // must be the first import, per the library's own setup docs
import React, { useState, useRef, useEffect } from 'react';
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
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Circle, Line, Defs, RadialGradient, Stop } from 'react-native-svg';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

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

// where a peer sits on the radar — same math as before, just pulled
// into a helper so both the svg lines and the label text can share it
function peerPosition(i, total) {
  const angle = (i / Math.max(total, 1)) * Math.PI * 2;
  return { x: Math.cos(angle) * 90, y: Math.sin(angle) * 90 };
}

// a handful of fixed, sparse background particles for texture — kept
// deliberately few, per the "non-distracting" rule from the moodboard
const BACKGROUND_DOTS = [
  { x: 40, y: 30, r: 1.5 }, { x: 210, y: 55, r: 1 }, { x: 60, y: 220, r: 1 },
  { x: 200, y: 200, r: 1.5 }, { x: 130, y: 20, r: 1 }, { x: 20, y: 130, r: 1 },
  { x: 240, y: 130, r: 1 }, { x: 130, y: 240, r: 1.5 },
];

export default function App() {
  // stage: 'intro' -> 'boarding' -> 'dock' -> 'radar'
  const [stage, setStage] = useState('intro');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [connectError, setConnectError] = useState(null);
  const [peers, setPeers] = useState([]);
  const [status, setStatus] = useState('pick anything');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [targetId, setTargetId] = useState(null); // NEW — selected peer, or null = mass send
  const [debugMsg, setDebugMsg] = useState(''); // NEW — visible debug trail

  // NEW — drives the projectile/dispersal-wave animation, 0 to 1
  // reflects real upload progress via XMLHttpRequest, not a fake timer
  const sendProgressAnim = useRef(new Animated.Value(0)).current;
  const [sendAnimActive, setSendAnimActive] = useState(false);
  const [sendAnimTargetPos, setSendAnimTargetPos] = useState(null); // null = dispersal wave

  // NEW — each peer gets its own pop-in scale, animated from 0 to 1
  // the first time it appears on the radar
  const peerScalesRef = useRef({});

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

  const getPeerScale = (deviceId) => {
    if (!peerScalesRef.current[deviceId]) {
      peerScalesRef.current[deviceId] = new Animated.Value(0);
    }
    return peerScalesRef.current[deviceId];
  };

  // whenever the peer list changes, any brand-new deviceId gets a
  // spring pop-in; peers we've already seen just stay at scale 1
  useEffect(() => {
    peers.forEach((peer) => {
      const scale = getPeerScale(peer.deviceId);
      // @ts-ignore - Animated.Value has no public "current value" getter,
      // so we track newness via whether it's still at its initial 0
      Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: false }).start();
    });
  }, [peers]);

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
  // FIXED — this is the actual missing piece. sending "accept_transfer"
  // used to be the WHOLE accept flow, but that only ever told the
  // server "yes" — nothing ever pulled the actual file bytes onto the
  // phone. now, accepting also downloads the real file via the new
  // /api/download/:id route, saves it to the app's local storage, and
  // opens the share sheet so you can actually keep it somewhere real
  // (Files, Photos, wherever) — phones can't just have a file silently
  // "appear" in a Downloads folder the way a desktop can.
  const acceptAndDownload = async (transferId) => {
    wsRef.current.send(JSON.stringify({ type: 'accept_transfer', transferId }));
    setStatus('receiving...');

    try {
      const destUri = FileSystem.cacheDirectory + `spatialdrop_${transferId}`;
      const result = await FileSystem.downloadAsync(
        `http://${hostIpRef.current}:3000/api/download/${transferId}`,
        destUri
      );
      debugLog(`downloaded to ${result.uri}`);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri);
      }
      setStatus(selectedFiles.length ? 'flick up to drop' : 'pick anything');
    } catch (err) {
      debugLog(`DOWNLOAD ERROR: ${err.message}`);
      setStatus('receive failed');
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
        acceptAndDownload(data.transferId);
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
            onPress: () => acceptAndDownload(data.transferId),
          },
        ]
      );
      return;
    }

    if (data.type === 'file_caught') {
      setStatus('they caught it');
      setTimeout(() => setStatus(selectedFiles.length ? 'flick up to drop' : 'pick anything'), 2500);
      return;
    }

    if (data.type === 'transfer_declined') {
      setStatus('declined');
      setTimeout(() => setStatus(selectedFiles.length ? 'flick up to drop' : 'pick anything'), 2500);
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
  // picking and sending are now separate: pick is a tap (has to be —
  // a phone can't swipe-select a file from nothing), send only fires
  // on an actual upward flick, matching the original "1. pick
  // anything / 2. swipe UP to drop" flow.

  // FIXED — this used to only offer DocumentPicker, which on iOS/Android
  // only shows the generic "Files" app, not the actual photo/video
  // library. Photos and Files are two genuinely separate system APIs on
  // both platforms — there's no single picker that covers both. now
  // this asks which source you want, then routes to the right one.
  const pickFiles = () => {
    Alert.alert('pick anything', 'choose a source', [
      { text: 'cancel', style: 'cancel' },
      { text: 'photos', onPress: pickFromPhotos },
      { text: 'files', onPress: pickFromFiles },
    ]);
  };

  const pickFromFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;

    setSelectedFiles(result.assets);
    setStatus(`${result.assets.length} file(s) loaded. ready to flick.`);
  };

  const pickFromPhotos = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setStatus('photo access denied — check phone settings');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'], // covers both photos and videos in the library
      allowsMultipleSelection: true,
    });
    if (result.canceled) return;

    // normalize to the exact same shape DocumentPicker gives us, so
    // sendFiles below doesn't need to know or care which source a file
    // came from
    const normalized = result.assets.map((a, i) => ({
      uri: a.uri,
      name: a.fileName || `photo_${Date.now()}_${i}`,
      mimeType: a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
    }));

    setSelectedFiles(normalized);
    setStatus(`${normalized.length} file(s) loaded. ready to flick.`);
  };

  const sendFiles = async () => {
    if (selectedFiles.length === 0) return; // nothing picked, swipe does nothing — same rule as the original web version

    const formData = new FormData();
    selectedFiles.forEach((f) => {
      formData.append('files', {
        uri: f.uri,
        name: f.name,
        type: f.mimeType || 'application/octet-stream',
      });
    });
    formData.append('roomId', pin);
    formData.append('deviceId', deviceIdRef.current);
    if (targetId) formData.append('targetId', targetId); // NEW — omitted entirely for a mass send

    // NEW — set up the animation before the request starts. a
    // specific target means a projectile flies toward that orb's
    // position; no target means a dispersal wave expanding from center
    if (targetId) {
      const idx = peers.findIndex((p) => p.deviceId === targetId);
      setSendAnimTargetPos(idx >= 0 ? peerPosition(idx, peers.length) : null);
    } else {
      setSendAnimTargetPos(null);
    }
    sendProgressAnim.setValue(0);
    setSendAnimActive(true);
    setStatus('dropping...');

    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `http://${hostIpRef.current}:3000/api/upload`);

      // NEW — this is the actual point of switching off fetch: fetch
      // has no upload progress event in React Native. this is real
      // byte-level progress, not a fake timer, so a big file genuinely
      // animates slower than a small one.
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          sendProgressAnim.setValue(event.loaded / event.total);
        }
      };

      xhr.onload = () => {
        setStatus(xhr.status === 201 ? 'sent — waiting for them to accept' : 'send failed');
        resolve();
      };
      xhr.onerror = () => {
        setStatus('send failed');
        resolve();
      };

      xhr.send(formData);
    });

    // let the animation visually finish (reach the target / fully
    // disperse) before hiding it, rather than snapping off instantly
    setTimeout(() => setSendAnimActive(false), 350);

    setSelectedFiles([]); // reset, ready for the next batch
    setTargetId(null); // NEW — clear selection after sending
  };

  // the actual swipe gesture — tracks the flick the same way the web
  // version tracked touchstart/touchend distance, but also checks
  // velocity so a slow drag doesn't accidentally trigger a send
  const swipeGesture = Gesture.Pan().onEnd((e) => {
    const swipedUpFarEnough = e.translationY < -100;
    const swipedFastEnough = e.velocityY < -500;
    if (swipedUpFarEnough && swipedFastEnough) {
      sendFiles();
    }
  });

  // NEW — tap a specific orb to target just that device. tapping
  // empty space clears the selection back to a mass send. attached
  // only to the 260x260 radar field, not the whole screen, so it
  // doesn't fight with the swipe gesture on the button/caption below.
  const tapGesture = Gesture.Tap().onEnd((e) => {
    let hit = null;
    peers.forEach((peer, i) => {
      const { x, y } = peerPosition(i, peers.length);
      const cx = 130 + x;
      const cy = 130 + y;
      const dist = Math.hypot(e.x - cx, e.y - cy);
      if (dist < 22) hit = peer.deviceId; // generous hit radius, easier to tap than the visual orb itself
    });
    setTargetId((current) => (hit === current ? null : hit)); // tapping the same orb again deselects it
  });

  // ---------- render ----------

  const digitBoxes = Array.from({ length: 6 }, (_, i) => pin[i] ?? null);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
          <GestureDetector gesture={swipeGesture}>
            <View style={styles.centerBlock}>
              <GestureDetector gesture={tapGesture}>
              <View style={styles.radarField}>
                <Svg width={260} height={260} style={StyleSheet.absoluteFill}>
                  <Defs>
                    <RadialGradient id="youGrad" cx="50%" cy="50%" r="50%">
                      <Stop offset="0%" stopColor="#fff6e0" stopOpacity="1" />
                      <Stop offset="100%" stopColor={COLORS.you} stopOpacity="1" />
                    </RadialGradient>
                    <RadialGradient id="idleGrad" cx="50%" cy="50%" r="50%">
                      <Stop offset="0%" stopColor="#c9a084" stopOpacity="1" />
                      <Stop offset="100%" stopColor={COLORS.idle} stopOpacity="1" />
                    </RadialGradient>
                    <RadialGradient id="sendingGrad" cx="50%" cy="50%" r="50%">
                      <Stop offset="0%" stopColor="#ffe9b0" stopOpacity="1" />
                      <Stop offset="100%" stopColor={COLORS.amber} stopOpacity="1" />
                    </RadialGradient>
                    <RadialGradient id="receivingGrad" cx="50%" cy="50%" r="50%">
                      <Stop offset="0%" stopColor="#c96a5a" stopOpacity="1" />
                      <Stop offset="100%" stopColor={COLORS.wine} stopOpacity="1" />
                    </RadialGradient>
                  </Defs>

                  {/* sparse background texture, drawn first so everything else sits on top */}
                  {BACKGROUND_DOTS.map((d, i) => (
                    <Circle key={`bg-${i}`} cx={d.x} cy={d.y} r={d.r} fill="#5a4030" opacity={0.35} />
                  ))}

                  {/* constellation lines, drawn before the orbs */}
                  {peers.map((peer, i) => {
                    const { x, y } = peerPosition(i, peers.length);
                    return (
                      <Line
                        key={`line-${peer.deviceId}`}
                        x1={130} y1={130}
                        x2={130 + x} y2={130 + y}
                        stroke="#7a3a28"
                        strokeWidth={1}
                        opacity={0.4}
                      />
                    );
                  })}

                  {/* peer orbs — 3-layer halo, radius driven by each peer's
                      own pop-in scale so new orbs grow in instead of just appearing */}
                  {peers.map((peer, i) => {
                    const { x, y } = peerPosition(i, peers.length);
                    const gradId = 'idleGrad'; // real sending/receiving state — separate item, not yet wired from backend
                    const r = 7;
                    const scale = getPeerScale(peer.deviceId);
                    return (
                      <React.Fragment key={peer.deviceId}>
                        <AnimatedCircle cx={130 + x} cy={130 + y} r={Animated.multiply(scale, r * 2.4)} fill={`url(#${gradId})`} opacity={0.1} />
                        <AnimatedCircle cx={130 + x} cy={130 + y} r={Animated.multiply(scale, r * 1.6)} fill={`url(#${gradId})`} opacity={0.25} />
                        <AnimatedCircle cx={130 + x} cy={130 + y} r={Animated.multiply(scale, r)} fill={`url(#${gradId})`} />
                      </React.Fragment>
                    );
                  })}

                  {/* selection ring — shows which orb is currently targeted */}
                  {targetId && (() => {
                    const idx = peers.findIndex((p) => p.deviceId === targetId);
                    if (idx === -1) return null;
                    const { x, y } = peerPosition(idx, peers.length);
                    return (
                      <Circle
                        cx={130 + x} cy={130 + y} r={16}
                        fill="none" stroke={COLORS.amber} strokeWidth={1.5} opacity={0.85}
                      />
                    );
                  })()}

                  {/* you, centered, slightly brighter/bigger than peers */}
                  <Circle cx={130} cy={130} r={20} fill="url(#youGrad)" opacity={0.12} />
                  <Circle cx={130} cy={130} r={14} fill="url(#youGrad)" opacity={0.3} />
                  <Circle cx={130} cy={130} r={9} fill="url(#youGrad)" />

                  {/* NEW — the send animation itself: a projectile toward
                      a specific orb, or an expanding ring for a mass send.
                      position/radius is driven directly by real upload
                      progress, not a fixed-duration timer. */}
                  {sendAnimActive && sendAnimTargetPos && (
                    <AnimatedCircle
                      cx={sendProgressAnim.interpolate({ inputRange: [0, 1], outputRange: [130, 130 + sendAnimTargetPos.x] })}
                      cy={sendProgressAnim.interpolate({ inputRange: [0, 1], outputRange: [130, 130 + sendAnimTargetPos.y] })}
                      r={5}
                      fill="url(#sendingGrad)"
                    />
                  )}
                  {sendAnimActive && !sendAnimTargetPos && (
                    <AnimatedCircle
                      cx={130}
                      cy={130}
                      r={sendProgressAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 120] })}
                      fill="none"
                      stroke={COLORS.amber}
                      strokeWidth={2}
                      opacity={sendProgressAnim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] })}
                    />
                  )}
                </Svg>

                {/* labels overlaid as plain text, same coordinates as the svg orbs */}
                {peers.map((peer, i) => {
                  const { x, y } = peerPosition(i, peers.length);
                  return (
                    <Text
                      key={`label-${peer.deviceId}`}
                      style={[styles.peerLabel, styles.peerLabelPositioned, { left: 130 + x - 40, top: 130 + y + 12 }]}
                    >
                      {peer.label}
                    </Text>
                  );
                })}
              </View>
              </GestureDetector>
              <Text style={styles.caption}>
                {status}{targetId ? ` → ${peers.find((p) => p.deviceId === targetId)?.label ?? ''}` : ''}
              </Text>
              <Pressable style={styles.ctaButton} onPress={pickFiles}>
                <Text style={styles.ctaText}>choose files</Text>
              </Pressable>
            </View>
          </GestureDetector>
        )}
      </Animated.View>
    </SafeAreaView>
    </GestureHandlerRootView>
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

  radarField: { width: 260, height: 260, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  peerLabel: { fontSize: 10, color: COLORS.caption },
  peerLabelPositioned: { position: 'absolute', width: 80, textAlign: 'center' },
  caption: { marginTop: 24, fontSize: 10, letterSpacing: 1.5, color: COLORS.caption },
});