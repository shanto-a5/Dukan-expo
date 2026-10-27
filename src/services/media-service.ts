import * as ImagePicker from 'expo-image-picker';

import { vantaApi } from '@/api/vanta-api';
import { getContainer } from '@/infrastructure/container';

export type MediaPickResult =
  | { status: 'picked'; uri: string }
  | { status: 'cancelled' }
  | { status: 'unavailable'; message: string };

export class MediaService {
  async pickImage(folder = 'products'): Promise<MediaPickResult> {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        return {
          status: 'unavailable',
          message: 'Photo access is turned off. Enable it in system settings, or add a placeholder image instead.',
        };
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.7,
      });
      if (result.canceled || result.assets.length === 0) return { status: 'cancelled' };
      return { status: 'picked', uri: await this.persist(result.assets[0].uri, folder) };
    } catch (error) {
      return {
        status: 'unavailable',
        message: error instanceof Error ? error.message : 'The photo library could not be opened on this device.',
      };
    }
  }

  async captureImage(folder = 'products'): Promise<MediaPickResult> {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        return { status: 'unavailable', message: 'Camera access is turned off for this app.' };
      }
      const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.7 });
      if (result.canceled || result.assets.length === 0) return { status: 'cancelled' };
      return { status: 'picked', uri: await this.persist(result.assets[0].uri, folder) };
    } catch (error) {
      return {
        status: 'unavailable',
        message: error instanceof Error ? error.message : 'The camera could not be opened on this device.',
      };
    }
  }

  async persist(uri: string, folder: string): Promise<string> {
    return getContainer().imageStorage.saveImageFromUri(uri, folder);
  }

  /**
   * Uploads an already-persisted image to the Vanta media endpoint and returns
   * its hosted HTTPS URL. This is the step that makes a photo visible to
   * customers: a device-local `file://` URI is only readable on the seller's own
   * phone, so it must never be what a product stores as its image.
   */
  async uploadImage(uri: string): Promise<string> {
    const { media } = await vantaApi.uploadSellerMedia(uri);
    return media.url;
  }
}

export const mediaService = new MediaService();
