import { useRef } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button } from './ui';
import { colors, space } from '../theme';
import { useT } from '../i18n';

/** Full-screen QR scanner. Calls onScan once per opening. */
export function QrScanner({ visible, title, onScan, onClose }: { visible: boolean; title: string; onScan: (data: string) => void; onClose: () => void }) {
  const { t } = useT();
  const [perm, requestPerm] = useCameraPermissions();
  const done = useRef(false);
  if (!visible) done.current = false;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Text style={styles.title}>{title}</Text>
        {!perm?.granted ? (
          <View style={{ padding: space(6) }}>
            <Text style={{ color: colors.cream, marginBottom: space(3) }}>{t('scanner.needCamera')}</Text>
            <Button title={t('scanner.allowCamera')} kind="accent" onPress={requestPerm} />
          </View>
        ) : (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (done.current) return;
              done.current = true;
              onScan(data);
            }}
          />
        )}
        <Button title={t('common.cancel')} kind="secondary" onPress={onClose} style={{ margin: space(5) }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.green, paddingTop: space(14) },
  title: { color: colors.cream, fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: space(4) },
  camera: { flex: 1, marginHorizontal: space(5), borderRadius: 24, overflow: 'hidden' },
});
