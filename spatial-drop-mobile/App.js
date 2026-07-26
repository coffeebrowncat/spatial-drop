import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Animated,
  StyleSheet,
  SafeAreaView,
} from 'react-native';

// ---- palette, warm direction from the moodboard update ----
// amber = sending, wine = receiving (per the "lighter indicates
// sending, darker receiving" note on the pink sticky) — this is a
// working hypothesis, not locked in, see the legibility flag below
const COLORS = {
  bg: '#0e0a09',
  boxBorder: '#3a221c',
  boxBorderFilled: '#f0c98a',
  digit: '#f5e6c8',
  digitEmpty: '#6b5040',
  you: '#f5e6c8',
  amber: '#f0c98a',   // sending state
  wine: '#7a2e2e',    // receiving state
  caption: '#6b5040',
};

// ---- fake peer data for now — Week 1 is visual only, no real ----
// ---- networking. this gets swapped for real websocket data in ----
// ---- Week 2. `state` drives which color the orb shows — this is ----
// ---- where the sending/receiving color-coding idea gets tested. ----
const MOCK_PEERS = [
  { id: 'peer1', label: "farwa's phone", state: 'sending', x: 70, y: -80 },
  { id: 'peer2', label: 'macbook', state: 'receiving', x: -90, y: 60 },
];

export default function App() {
  // 'dock' -> entering the pin. 'radar' -> connected, browsing peers.
  const [stage, setStage] = useState('dock');
  const [pin, setPin] = useState('');
  const inputRef = useRef(null);

  // one shared value drives the crossfade between dock and radar,
  // instead of navigating to a new screen. this is the "seamless"
  // canvas approach from the moodboard pass.
  const dockOpacity = useRef(new Animated.Value(1)).current;
  const radarOpacity = useRef(new Animated.Value(0)).current;
  const youScale = useRef(new Animated.Value(0)).current;

  const handlePinChange = (text) => {
    const digitsOnly = text.replace(/[^0-9]/g, '').slice(0, 6);
    setPin(digitsOnly);

    if (digitsOnly.length === 6) {
      // pretend-validate for now — Week 2 swaps this for an actual
      // pin lookup against the server
      setTimeout(() => enterRadar(), 250);
    }
  };

  const enterRadar = () => {
    setStage('radar');
    Animated.parallel([
      Animated.timing(dockOpacity, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.timing(radarOpacity, {
        toValue: 1,
        duration: 500,
        delay: 150,
        useNativeDriver: true,
      }),
      Animated.spring(youScale, {
        toValue: 1,
        friction: 6,
        delay: 150,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const digitBoxes = Array.from({ length: 6 }, (_, i) => pin[i] ?? null);

  return (
    <SafeAreaView style={styles.safe}>
      <Pressable style={styles.canvas} onPress={() => inputRef.current?.focus()}>
        {/* hidden input actually captures keystrokes; the boxes below are just display */}
        <TextInput
          ref={inputRef}
          value={pin}
          onChangeText={handlePinChange}
          keyboardType="number-pad"
          maxLength={6}
          style={styles.hiddenInput}
          autoFocus
        />

        {/* ---------- DOCK STAGE ---------- */}
        <Animated.View
          pointerEvents={stage === 'dock' ? 'auto' : 'none'}
          style={[styles.dockLayer, { opacity: dockOpacity }]}
        >
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
        </Animated.View>

        {/* ---------- RADAR STAGE ---------- */}
        <Animated.View
          pointerEvents={stage === 'radar' ? 'auto' : 'none'}
          style={[styles.radarLayer, { opacity: radarOpacity }]}
        >
          <View style={styles.radarField}>
            {MOCK_PEERS.map((peer) => (
              <View
                key={peer.id}
                style={[
                  styles.peer,
                  { transform: [{ translateX: peer.x }, { translateY: peer.y }] },
                ]}
              >
                <View
                  style={[
                    styles.peerDot,
                    { backgroundColor: peer.state === 'sending' ? COLORS.amber : COLORS.wine },
                  ]}
                />
                <Text style={styles.peerLabel}>{peer.label}</Text>
              </View>
            ))}

            <Animated.View
              style={[
                styles.youDot,
                { transform: [{ scale: youScale }] },
              ]}
            />
          </View>

          <Text style={styles.caption}>flick up to drop</Text>
        </Animated.View>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  canvas: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },

  // dock stage
  dockLayer: { position: 'absolute', alignItems: 'center' },
  label: {
    color: COLORS.caption,
    fontSize: 12,
    letterSpacing: 2,
    marginBottom: 18,
    textTransform: 'lowercase',
  },
  pinRow: { flexDirection: 'row', gap: 8 },
  pinBox: {
    width: 34,
    height: 42,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDigit: { fontSize: 16 },

  // radar stage
  radarLayer: { position: 'absolute', alignItems: 'center' },
  radarField: {
    width: 260,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  youDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.you,
  },
  peer: { position: 'absolute', alignItems: 'center', gap: 6 },
  peerDot: { width: 13, height: 13, borderRadius: 7 },
  peerLabel: { fontSize: 10, color: COLORS.caption },
  caption: { marginTop: 30, fontSize: 10, letterSpacing: 1.5, color: COLORS.caption },
});