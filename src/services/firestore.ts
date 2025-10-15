import {
  collection,
  doc,
  getDoc,
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
import type { Band, EventSettings, Timetable, DailyTimetable } from '../types';

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
const firestoreToBand = (id: string, data: DocumentData): Band => {
  // 常に新しいオブジェクトインスタンスを作成してReactの変更検知を確実にする
  return {
    id,
    name: data.name,
    performanceDuration: data.performanceDuration,
    performanceCount: data.performanceCount,
    // 配列は必ず新しいインスタンスを作成
    members: Array.isArray(data.members) ? [...data.members] : [],
    availableTimeSlots: Array.isArray(data.availableTimeSlots) 
      ? data.availableTimeSlots.map((slot: { date: string; timeRanges: { startTime: string; endTime: string }[] }) => ({
          date: slot.date,
          timeRanges: Array.isArray(slot.timeRanges) 
            ? slot.timeRanges.map((range: { startTime: string; endTime: string }) => ({
                startTime: range.startTime,
                endTime: range.endTime,
              }))
            : [],
        }))
      : [],
    // Dateオブジェクトも必ず新しいインスタンスを作成
    createdAt: data.createdAt?.toDate() ? new Date(data.createdAt.toDate().getTime()) : new Date(),
    updatedAt: data.updatedAt?.toDate() ? new Date(data.updatedAt.toDate().getTime()) : new Date(),
  };
};

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
const eventSettingsToFirestore = (settings: EventSettings): Partial<EventSettingsFirestore> & Omit<EventSettingsFirestore, 'rehearsalDates' | 'rehearsalDuration' | 'customEvents'> => {
  // Firestoreはundefined値を許容しないため、undefinedフィールドは除外する
  const firestoreData: Partial<EventSettingsFirestore> & Omit<EventSettingsFirestore, 'rehearsalDates' | 'rehearsalDuration' | 'customEvents'> = {
    name: settings.name,
    year: settings.year,
    venue: settings.venue,
    goal: settings.goal,
    performanceDates: settings.performanceDates,
    rehearsalType: settings.rehearsalType,
    presetDurations: settings.presetDurations,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  // rehearsalDatesがundefinedでない場合のみ含める
  if (settings.rehearsalDates !== undefined) {
    (firestoreData as EventSettingsFirestore).rehearsalDates = settings.rehearsalDates;
  }

  // rehearsalDurationがundefinedでない場合のみ含める
  if (settings.rehearsalDuration !== undefined) {
    (firestoreData as EventSettingsFirestore).rehearsalDuration = settings.rehearsalDuration;
  }

  // customEventsがundefinedでない場合のみ含める
  if (settings.customEvents !== undefined) {
    (firestoreData as EventSettingsFirestore).customEvents = settings.customEvents;
  }

  return firestoreData as EventSettingsFirestore;
};

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
  customEvents: data.customEvents || [],
});

// イベント設定のFirestore操作
export const eventService = {
  // イベント設定を作成
  async createEvent(settings: Omit<EventSettings, 'id'>): Promise<string> {
    try {
      console.log('[eventService.createEvent] 開始:', settings);
      const eventsRef = collection(db, 'events');
      const settingsData = eventSettingsToFirestore({ ...settings, id: '' });
      console.log('[eventService.createEvent] Firestore形式に変換:', settingsData);
      const docRef = await addDoc(eventsRef, settingsData);
      console.log('[eventService.createEvent] 成功:', docRef.id);
      return docRef.id;
    } catch (error) {
      console.error('[eventService.createEvent] エラー:', error);
      throw error;
    }
  },

  // イベント設定を取得
  async getEvent(eventId: string): Promise<EventSettings | null> {
    try {
      console.log('[eventService.getEvent] 開始:', eventId);
      const eventRef = doc(db, 'events', eventId);
      const eventDoc = await getDoc(eventRef);
      
      console.log('[eventService.getEvent] ドキュメント存在:', eventDoc.exists());
      
      if (!eventDoc.exists()) {
        console.log('[eventService.getEvent] ドキュメントが存在しません');
        return null;
      }
      
      const data = eventDoc.data();
      console.log('[eventService.getEvent] 生データ:', data);
      
      const settings = firestoreToEventSettings(eventDoc.id, data);
      console.log('[eventService.getEvent] 変換後:', settings);
      
      return settings;
    } catch (error) {
      console.error('[eventService.getEvent] エラー:', error);
      throw error;
    }
  },

  // イベント設定を更新
  async updateEvent(eventId: string, updates: Partial<EventSettings>): Promise<void> {
    const eventRef = doc(db, 'events', eventId);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};
    
    // 指定されたフィールドのみを更新データに含める
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.year !== undefined) updateData.year = updates.year;
    if (updates.venue !== undefined) updateData.venue = updates.venue;
    if (updates.goal !== undefined) updateData.goal = updates.goal;
    if (updates.performanceDates !== undefined) updateData.performanceDates = updates.performanceDates;
    if (updates.rehearsalType !== undefined) updateData.rehearsalType = updates.rehearsalType;
    if (updates.rehearsalDates !== undefined) updateData.rehearsalDates = updates.rehearsalDates;
    if (updates.rehearsalDuration !== undefined) updateData.rehearsalDuration = updates.rehearsalDuration;
    if (updates.presetDurations !== undefined) updateData.presetDurations = updates.presetDurations;
    if (updates.customEvents !== undefined) updateData.customEvents = updates.customEvents;
    
    // updatedAtは常に更新
    updateData.updatedAt = Timestamp.now();
    
    await updateDoc(eventRef, updateData);
  },

  // イベントを削除(関連する全てのデータも削除)
  async deleteEvent(eventId: string): Promise<void> {
    try {
      console.log('[eventService.deleteEvent] 開始:', eventId);

      // イベントに関連する全てのタイムテーブルを削除
      const timetablesRef = collection(db, 'timetables');
      const timetablesQuery = query(timetablesRef, where('eventId', '==', eventId));
      const timetablesSnapshot = await getDocs(timetablesQuery);
      
      const timetableDeletePromises = timetablesSnapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(timetableDeletePromises);
      console.log(`[eventService.deleteEvent] ${timetablesSnapshot.size}件のタイムテーブルを削除`);

      // イベントに関連する全てのバンドを削除
      const bandsRef = collection(db, 'bands');
      const bandsQuery = query(bandsRef, where('eventId', '==', eventId));
      const bandsSnapshot = await getDocs(bandsQuery);
      
      const bandDeletePromises = bandsSnapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(bandDeletePromises);
      console.log(`[eventService.deleteEvent] ${bandsSnapshot.size}件のバンドを削除`);

      // イベント設定を削除
      const eventRef = doc(db, 'events', eventId);
      await deleteDoc(eventRef);
      console.log('[eventService.deleteEvent] イベント設定を削除');

      console.log('[eventService.deleteEvent] 完了');
    } catch (error) {
      console.error('[eventService.deleteEvent] エラー:', error);
      throw error;
    }
  },
};

// Firestore用のTimetable型
interface TimetableFirestore extends Omit<Timetable, 'id' | 'createdAt' | 'updatedAt'> {
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// TimetableをFirestore形式に変換
const timetableToFirestore = (timetable: Timetable): Omit<TimetableFirestore, 'id'> => ({
  eventId: timetable.eventId,
  type: timetable.type,
  dailyTimetables: timetable.dailyTimetables,
  createdAt: Timestamp.fromDate(timetable.createdAt),
  updatedAt: Timestamp.fromDate(timetable.updatedAt),
});

// Firestore形式からTimetableに変換
const firestoreToTimetable = (id: string, data: DocumentData): Timetable => ({
  id,
  eventId: data.eventId,
  type: data.type,
  dailyTimetables: data.dailyTimetables || [],
  createdAt: data.createdAt?.toDate() || new Date(),
  updatedAt: data.updatedAt?.toDate() || new Date(),
});

// タイムテーブルのFirestore操作
export const timetableService = {
  // タイムテーブルを取得
  async getTimetable(eventId: string, type: 'performance' | 'rehearsal'): Promise<Timetable | null> {
    const timetablesRef = collection(db, 'timetables');
    const q = query(
      timetablesRef,
      where('eventId', '==', eventId),
      where('type', '==', type)
    );
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return null;
    }
    
    const timetableDoc = snapshot.docs[0];
    return firestoreToTimetable(timetableDoc.id, timetableDoc.data());
  },

  // タイムテーブルを作成
  async createTimetable(timetable: Omit<Timetable, 'id'>): Promise<string> {
    const timetablesRef = collection(db, 'timetables');
    const timetableData = timetableToFirestore({ ...timetable, id: '' });
    const docRef = await addDoc(timetablesRef, timetableData);
    return docRef.id;
  },

  // タイムテーブルを更新
  async updateTimetable(timetableId: string, updates: Partial<Timetable>): Promise<void> {
    const timetableRef = doc(db, 'timetables', timetableId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      ...updates,
      updatedAt: Timestamp.now(),
    };
    
    delete updateData.id;
    delete updateData.createdAt;
    
    await updateDoc(timetableRef, updateData);
  },

  // 日別タイムテーブルを更新
  async updateDailyTimetable(
    timetableId: string,
    dailyTimetable: DailyTimetable
  ): Promise<void> {
    const timetableRef = doc(db, 'timetables', timetableId);
    const timetable = await this.getTimetableById(timetableId);
    
    if (!timetable) {
      throw new Error('Timetable not found');
    }
    
    const existingIndex = timetable.dailyTimetables.findIndex(
      (dt) => dt.date === dailyTimetable.date
    );
    
    const newDailyTimetables = [...timetable.dailyTimetables];
    if (existingIndex >= 0) {
      newDailyTimetables[existingIndex] = dailyTimetable;
    } else {
      newDailyTimetables.push(dailyTimetable);
    }
    
    await updateDoc(timetableRef, {
      dailyTimetables: newDailyTimetables,
      updatedAt: Timestamp.now(),
    });
  },

  // IDでタイムテーブルを取得
  async getTimetableById(timetableId: string): Promise<Timetable | null> {
    const snapshot = await getDocs(
      query(collection(db, 'timetables'), where('__name__', '==', timetableId))
    );
    
    if (snapshot.empty) {
      return null;
    }
    
    const timetableDoc = snapshot.docs[0];
    return firestoreToTimetable(timetableDoc.id, timetableDoc.data());
  },

  // タイムテーブルをリアルタイム監視
  subscribeTimetable(
    eventId: string,
    type: 'performance' | 'rehearsal',
    callback: (timetable: Timetable | null) => void
  ): () => void {
    const timetablesRef = collection(db, 'timetables');
    const q = query(
      timetablesRef,
      where('eventId', '==', eventId),
      where('type', '==', type)
    );
    
    return onSnapshot(q, (snapshot: QuerySnapshot) => {
      if (snapshot.empty) {
        callback(null);
        return;
      }
      
      const timetableDoc = snapshot.docs[0];
      callback(firestoreToTimetable(timetableDoc.id, timetableDoc.data()));
    });
  },
};
