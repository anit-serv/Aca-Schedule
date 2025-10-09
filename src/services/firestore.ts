import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  Timestamp,
  QuerySnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Band, EventSettings } from '../types';

// Firestore用のBand型（Dateの代わりにTimestampを使用）
interface BandFirestore extends Omit<Band, 'createdAt' | 'updatedAt'> {
  eventId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// BandをFirestore形式に変換
const bandToFirestore = (band: Band, eventId: string): Omit<BandFirestore, 'id'> => ({
  eventId,
  name: band.name,
  performanceDuration: band.performanceDuration,
  performanceCount: band.performanceCount,
  members: band.members,
  availableTimeSlots: band.availableTimeSlots,
  createdAt: Timestamp.fromDate(band.createdAt),
  updatedAt: Timestamp.fromDate(band.updatedAt),
});

// Firestore形式からBandに変換
const firestoreToBand = (id: string, data: DocumentData): Band => ({
  id,
  name: data.name,
  performanceDuration: data.performanceDuration,
  performanceCount: data.performanceCount,
  members: data.members || [],
  availableTimeSlots: data.availableTimeSlots || [],
  createdAt: data.createdAt?.toDate() || new Date(),
  updatedAt: data.updatedAt?.toDate() || new Date(),
});

// バンド管理のFirestore操作
export const bandService = {
  // バンド一覧を取得
  async getBands(eventId: string): Promise<Band[]> {
    const bandsRef = collection(db, 'bands');
    const q = query(bandsRef, where('eventId', '==', eventId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => firestoreToBand(doc.id, doc.data()));
  },

  // バンド一覧をリアルタイム監視
  subscribeToBands(
    eventId: string,
    callback: (bands: Band[]) => void
  ): () => void {
    const bandsRef = collection(db, 'bands');
    const q = query(bandsRef, where('eventId', '==', eventId));
    
    return onSnapshot(q, (snapshot: QuerySnapshot) => {
      const bands = snapshot.docs.map(doc => firestoreToBand(doc.id, doc.data()));
      callback(bands);
    });
  },

  // バンドを追加
  async addBand(band: Band, eventId: string): Promise<string> {
    const bandsRef = collection(db, 'bands');
    const bandData = bandToFirestore(band, eventId);
    const docRef = await addDoc(bandsRef, bandData);
    return docRef.id;
  },

  // バンドを更新
  async updateBand(bandId: string, updates: Partial<Band>): Promise<void> {
    const bandRef = doc(db, 'bands', bandId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      ...updates,
      updatedAt: Timestamp.now(),
    };
    
    // createdAtとidは更新しない
    delete updateData.createdAt;
    delete updateData.id;
    
    await updateDoc(bandRef, updateData);
  },

  // バンドを削除
  async deleteBand(bandId: string): Promise<void> {
    const bandRef = doc(db, 'bands', bandId);
    await deleteDoc(bandRef);
  },
};

// Firestore用のEventSettings型
interface EventSettingsFirestore extends Omit<EventSettings, 'id'> {
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// EventSettingsをFirestore形式に変換
const eventSettingsToFirestore = (settings: EventSettings): EventSettingsFirestore => ({
  name: settings.name,
  year: settings.year,
  venue: settings.venue,
  goal: settings.goal,
  performanceDates: settings.performanceDates,
  rehearsalType: settings.rehearsalType,
  rehearsalDates: settings.rehearsalDates,
  rehearsalDuration: settings.rehearsalDuration,
  presetDurations: settings.presetDurations,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
});

// Firestore形式からEventSettingsに変換
const firestoreToEventSettings = (id: string, data: DocumentData): EventSettings => ({
  id,
  name: data.name,
  year: data.year,
  venue: data.venue,
  goal: data.goal,
  performanceDates: data.performanceDates || [],
  rehearsalType: data.rehearsalType || 'none',
  rehearsalDates: data.rehearsalDates,
  rehearsalDuration: data.rehearsalDuration,
  presetDurations: data.presetDurations || [10, 15, 20],
});

// イベント設定のFirestore操作
export const eventService = {
  // イベント設定を作成
  async createEvent(settings: Omit<EventSettings, 'id'>): Promise<string> {
    const eventsRef = collection(db, 'events');
    const settingsData = eventSettingsToFirestore({ ...settings, id: '' });
    const docRef = await addDoc(eventsRef, settingsData);
    return docRef.id;
  },

  // イベント設定を取得
  async getEvent(eventId: string): Promise<EventSettings | null> {
    const snapshot = await getDocs(query(collection(db, 'events'), where('__name__', '==', eventId)));
    
    if (snapshot.empty) {
      return null;
    }
    
    const eventDoc = snapshot.docs[0];
    return firestoreToEventSettings(eventDoc.id, eventDoc.data());
  },

  // イベント設定を更新
  async updateEvent(eventId: string, updates: Partial<EventSettings>): Promise<void> {
    const eventRef = doc(db, 'events', eventId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      ...updates,
      updatedAt: Timestamp.now(),
    };
    
    delete updateData.id;
    
    await updateDoc(eventRef, updateData);
  },
};
