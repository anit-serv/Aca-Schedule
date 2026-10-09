import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  QuerySnapshot,
  runTransaction,
  writeBatch,
  arrayUnion,
  arrayRemove,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { AppUser, Band, EventSettings, Timetable, DailyTimetable } from '../types';
import { writeRateLimiter, RateLimitError } from '../utils/writeRateLimiter';
import { selectBestTimetable } from '../utils/timetableSelection';

// ユーザー管理のFirestore操作
export const userService = {
  // ユーザー情報を保存/更新
  async saveUser(user: AppUser): Promise<void> {
    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      await setDoc(userRef, {
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    } else {
      const existing = userDoc.data();
      const isSameProfile =
        (existing.email || null) === (user.email || null) &&
        (existing.displayName || null) === (user.displayName || null) &&
        (existing.photoURL || null) === (user.photoURL || null);

      if (isSameProfile) {
        return;
      }

      await updateDoc(userRef, {
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        updatedAt: Timestamp.now(),
      });
    }
  },
};

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
  toriPriority: band.toriPriority,
  costume: band.costume,
  bandMaster: band.bandMaster,
  members: band.members,
  availableTimeSlots: band.availableTimeSlots,
  backupRehearsalTimeSlots: band.backupRehearsalTimeSlots ?? [],
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
    toriPriority: [1, 2, 3].includes(data.toriPriority) ? data.toriPriority : 1,
    costume: data.costume === true,
    bandMaster: typeof data.bandMaster === 'string' ? data.bandMaster : '',
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
    backupRehearsalTimeSlots: Array.isArray(data.backupRehearsalTimeSlots)
      ? data.backupRehearsalTimeSlots.map((slot: { date: string; timeRanges: { startTime: string; endTime: string }[] }) => ({
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
    callback: (bands: Band[]) => void,
    onError?: (error: Error) => void
  ): () => void {
    const bandsRef = collection(db, 'bands');
    const q = query(bandsRef, where('eventId', '==', eventId));
    
    let unsubscribe: () => void = () => {};
    unsubscribe = onSnapshot(
      q,
      (snapshot: QuerySnapshot) => {
        const bands = snapshot.docs.map(doc => firestoreToBand(doc.id, doc.data()));
        // createdAt順にソート（古い順）
        bands.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        callback(bands);
      },
      (error) => {
        console.error('[bandService.subscribeToBands] エラー:', error);
        // Quota超過時は購読を停止し、バックエンドへの過剰リトライを避ける
        if ((error as { code?: string })?.code === 'resource-exhausted') {
          unsubscribe();
        }
        if (onError) onError(error);
      }
    );

    return () => unsubscribe();
  },

  // バンドを追加
  async addBand(band: Band, eventId: string): Promise<string> {
    if (!writeRateLimiter.check('addBand')) throw new RateLimitError();
    const bandRef = doc(db, 'bands', band.id);
    const bandData = bandToFirestore(band, eventId);
    await setDoc(bandRef, bandData);
    return band.id;
  },

  // バンドを更新
  async updateBand(bandId: string, updates: Partial<Band>): Promise<void> {
    if (!writeRateLimiter.check('updateBand')) throw new RateLimitError();
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
    if (!writeRateLimiter.check('deleteBand')) throw new RateLimitError();
    const bandRef = doc(db, 'bands', bandId);
    await deleteDoc(bandRef);
  },
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
  ownerId: data.ownerId || '',
  customFields: data.customFields,
  isPublic: data.isPublic || false,
  collaboratorEmails: [...new Set<string>(data.collaboratorEmails || [])],
  pendingCollaboratorEmails: [...new Set<string>(data.pendingCollaboratorEmails || [])],
  pendingOwnerEmail: data.pendingOwnerEmail || undefined,
});

// イベント設定のFirestore操作
export const eventService = {
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

  // イベント設定をリアルタイム監視
  subscribeToEvent(
    eventId: string,
    callback: (settings: EventSettings | null) => void,
    onError?: (error: Error) => void
  ): () => void {
    const eventRef = doc(db, 'events', eventId);
    let unsubscribe: () => void = () => {};
    unsubscribe = onSnapshot(
      eventRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          callback(null);
          return;
        }
        const settings = firestoreToEventSettings(snapshot.id, snapshot.data());
        callback(settings);
      },
      (error) => {
        console.error('[eventService.subscribeToEvent] エラー:', error);
        if ((error as { code?: string })?.code === 'resource-exhausted') {
          unsubscribe();
        }
        if (onError) onError(error);
      }
    );

    return () => unsubscribe();
  },

  // イベント設定を更新
  async updateEvent(eventId: string, updates: Partial<EventSettings>): Promise<void> {
    if (!writeRateLimiter.check('updateEvent')) throw new RateLimitError();
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
    if (updates.customFields !== undefined) updateData.customFields = updates.customFields;
    if (updates.isPublic !== undefined) updateData.isPublic = updates.isPublic;
    if (updates.collaboratorEmails !== undefined) updateData.collaboratorEmails = updates.collaboratorEmails;
    if (updates.pendingCollaboratorEmails !== undefined) updateData.pendingCollaboratorEmails = updates.pendingCollaboratorEmails;
    if (updates.pendingOwnerEmail !== undefined) updateData.pendingOwnerEmail = updates.pendingOwnerEmail;
    
    // updatedAtは常に更新
    updateData.updatedAt = Timestamp.now();
    
    await updateDoc(eventRef, updateData);
  },

  // ユーザーのイベント一覧を取得
  async getEventsByOwner(ownerId: string): Promise<EventSettings[]> {
    try {
      const eventsRef = collection(db, 'events');
      const q = query(eventsRef, where('ownerId', '==', ownerId), orderBy('updatedAt', 'desc'));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => firestoreToEventSettings(doc.id, doc.data()));
    } catch (error) {
      console.error('[eventService.getEventsByOwner] エラー:', error);
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
  rehearsalInitialized: timetable.rehearsalInitialized ?? false,
  createdAt: Timestamp.fromDate(timetable.createdAt),
  updatedAt: Timestamp.fromDate(timetable.updatedAt),
});

// Firestore形式からTimetableに変換
const firestoreToTimetable = (id: string, data: DocumentData): Timetable => {
  // createdAt/updatedAtはTimestampの場合とDateの場合がある
  const parseDate = (value: unknown): Date => {
    if (!value) return new Date();
    if (value instanceof Date) return value;
    if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
      return (value as { toDate: () => Date }).toDate();
    }
    return new Date();
  };
  
  return {
    id,
    eventId: data.eventId,
    type: data.type,
    dailyTimetables: data.dailyTimetables || [],
    rehearsalInitialized: data.rehearsalInitialized ?? false,
    createdAt: parseDate(data.createdAt),
    updatedAt: parseDate(data.updatedAt),
  };
};

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
    
    const bestDoc = selectBestTimetable(snapshot.docs.map(item => ({ data: item.data(), doc: item })))!.doc;
    
    return firestoreToTimetable(bestDoc.id, bestDoc.data());
  },

  // タイムテーブルを作成
  async createTimetable(timetable: Omit<Timetable, 'id'>): Promise<string> {
    if (!writeRateLimiter.check('createTimetable')) throw new RateLimitError();
    const timetablesRef = collection(db, 'timetables');
    const timetableData = timetableToFirestore({ ...timetable, id: '' });
    const docRef = await addDoc(timetablesRef, timetableData);
    return docRef.id;
  },

  // タイムテーブルを更新
  async updateTimetable(timetableId: string, updates: Partial<Timetable>): Promise<void> {
    if (!writeRateLimiter.check('updateTimetable')) throw new RateLimitError();
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

  // クール直前リハの同期では、両方の最新状態を同一トランザクションで読み、
  // 手動編集されたリハの配置を古いスナップショットで上書きしない。
  async syncCoolPreRehearsal(
    performanceId: string,
    rehearsalId: string,
    buildUpdates: (performance: Timetable, rehearsal: Timetable) => Partial<Timetable> | null,
  ): Promise<void> {
    if (!writeRateLimiter.check('updateTimetable')) throw new RateLimitError();
    const performanceRef = doc(db, 'timetables', performanceId);
    const rehearsalRef = doc(db, 'timetables', rehearsalId);
    await runTransaction(db, async transaction => {
      const [performanceSnapshot, rehearsalSnapshot] = await Promise.all([
        transaction.get(performanceRef), transaction.get(rehearsalRef),
      ]);
      if (!performanceSnapshot.exists() || !rehearsalSnapshot.exists()) return;
      const updates = buildUpdates(
        firestoreToTimetable(performanceSnapshot.id, performanceSnapshot.data()),
        firestoreToTimetable(rehearsalSnapshot.id, rehearsalSnapshot.data()),
      );
      if (updates) transaction.update(rehearsalRef, { ...updates, updatedAt: Timestamp.now() });
    });
  },

  // 自動配置した全日程と位置固定のカスタム項目を同時に保存
  async saveAutoSchedule(timetableId: string, eventId: string, dailyTimetables: DailyTimetable[], customFields?: EventSettings['customFields']): Promise<void> {
    if (!writeRateLimiter.check('updateTimetable')) throw new RateLimitError();
    const batch = writeBatch(db);
    batch.update(doc(db, 'timetables', timetableId), { dailyTimetables, updatedAt: Timestamp.now() });
    if (customFields) {
      batch.update(doc(db, 'events', eventId), { customFields, updatedAt: Timestamp.now() });
    }
    await batch.commit();
  },

  async resetAllTimetables(
    performanceId: string,
    rehearsalId: string | null,
    eventId: string,
    performanceDays: DailyTimetable[] | null,
    rehearsalDays: DailyTimetable[] | null,
    customFields?: EventSettings['customFields'],
  ): Promise<void> {
    if (!writeRateLimiter.check('updateTimetable')) throw new RateLimitError();
    const batch = writeBatch(db);
    if (performanceDays) {
      batch.update(doc(db, 'timetables', performanceId), { dailyTimetables: performanceDays, updatedAt: Timestamp.now() });
    }
    if (rehearsalId && rehearsalDays) {
      batch.update(doc(db, 'timetables', rehearsalId), { dailyTimetables: rehearsalDays, updatedAt: Timestamp.now() });
    }
    if (customFields) {
      batch.update(doc(db, 'events', eventId), { customFields, updatedAt: Timestamp.now() });
    }
    await batch.commit();
  },

  // 日別タイムテーブルを更新（トランザクション使用で競合安全）
  async updateDailyTimetable(
    timetableId: string,
    dailyTimetable: DailyTimetable,
    orderedDates?: string[]
  ): Promise<void> {
    if (!writeRateLimiter.check('updateDailyTimetable')) throw new RateLimitError();
    const timetableRef = doc(db, 'timetables', timetableId);
    
    await runTransaction(db, async (transaction) => {
      const timetableDoc = await transaction.get(timetableRef);
      
      if (!timetableDoc.exists()) {
        throw new Error('Timetable not found');
      }
      
      const data = timetableDoc.data();
      const dailyTimetables = data.dailyTimetables || [];
      
      const existingIndex = dailyTimetables.findIndex(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dt: any) => dt.date === dailyTimetable.date
      );
      
      const newDailyTimetables = [...dailyTimetables];
      if (existingIndex >= 0) {
        newDailyTimetables[existingIndex] = dailyTimetable;
      } else {
        newDailyTimetables.push(dailyTimetable);
      }

      // Number all cools from the latest document so an edit to one day cannot
      // restore stale entries from another day.
      if (orderedDates?.length) {
        let coolNumber = 1;
        for (const date of [...orderedDates].sort()) {
          const index = newDailyTimetables.findIndex((day: DailyTimetable) => day.date === date);
          if (index < 0 || !newDailyTimetables[index].cools) continue;
          const day = newDailyTimetables[index] as DailyTimetable;
          newDailyTimetables[index] = {
            ...day,
            cools: day.cools!.map(cool => ({ ...cool, number: coolNumber++ })),
          };
        }
      }
      
      transaction.update(timetableRef, {
        dailyTimetables: newDailyTimetables,
        updatedAt: Timestamp.now(),
      });
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
  // Firestoreは書き込み時にローカルキャッシュを即座に更新し、onSnapshotをトリガーするため
  // 楽観的更新は不要。常にonSnapshotからのデータを受け入れる。
  subscribeTimetable(
    eventId: string,
    type: 'performance' | 'rehearsal',
    callback: (timetable: Timetable | null) => void,
    onError?: (error: Error) => void
  ): () => void {
    const timetablesRef = collection(db, 'timetables');
    const q = query(
      timetablesRef,
      where('eventId', '==', eventId),
      where('type', '==', type)
    );
    
    let unsubscribe: () => void = () => {};
    unsubscribe = onSnapshot(
      q,
      (snapshot: QuerySnapshot) => {
        if (snapshot.empty) {
          callback(null);
          return;
        }
        
        const bestDoc = selectBestTimetable(snapshot.docs.map(item => ({ data: item.data(), doc: item })))!.doc;
        
        callback(firestoreToTimetable(bestDoc.id, bestDoc.data()));
      },
      (error) => {
        console.error('[timetableService.subscribeTimetable] エラー:', error);
        if ((error as { code?: string })?.code === 'resource-exhausted') {
          unsubscribe();
        }
        if (onError) onError(error);
      }
    );

    return () => unsubscribe();
  },
};

// 共同編集者管理のFirestore操作
export const collaboratorService = {
  // 共同編集者を招待（オーナーが実行 → pendingに追加）
  async addCollaborator(eventId: string, email: string): Promise<void> {
    const eventRef = doc(db, 'events', eventId);
    await updateDoc(eventRef, {
      pendingCollaboratorEmails: arrayUnion(email.toLowerCase().trim()),
      updatedAt: Timestamp.now(),
    });
  },

  // 共同編集者を削除（オーナーが実行 → 両方の配列から削除）
  async removeCollaborator(eventId: string, email: string): Promise<void> {
    const eventRef = doc(db, 'events', eventId);
    await updateDoc(eventRef, {
      collaboratorEmails: arrayRemove(email.toLowerCase().trim()),
      pendingCollaboratorEmails: arrayRemove(email.toLowerCase().trim()),
      updatedAt: Timestamp.now(),
    });
  },

  // 招待を承認（招待された本人が実行 → pendingから削除、collaboratorに追加）
  async acceptCollaboration(eventId: string, email: string): Promise<void> {
    const eventRef = doc(db, 'events', eventId);
    await updateDoc(eventRef, {
      pendingCollaboratorEmails: arrayRemove(email.toLowerCase().trim()),
      collaboratorEmails: arrayUnion(email.toLowerCase().trim()),
      updatedAt: Timestamp.now(),
    });
  },

  // 招待を辞退 / 共同編集を辞退（本人が実行 → 両方の配列から削除）
  async declineCollaboration(eventId: string, email: string): Promise<void> {
    const eventRef = doc(db, 'events', eventId);
    await updateDoc(eventRef, {
      collaboratorEmails: arrayRemove(email.toLowerCase().trim()),
      pendingCollaboratorEmails: arrayRemove(email.toLowerCase().trim()),
      updatedAt: Timestamp.now(),
    });
  },

  // 承認済み共同編集者のイベント一覧を取得
  async getSharedEvents(email: string): Promise<EventSettings[]> {
    try {
      const eventsRef = collection(db, 'events');
      const q = query(eventsRef, where('collaboratorEmails', 'array-contains', email.toLowerCase().trim()));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => firestoreToEventSettings(d.id, d.data()));
    } catch (error) {
      console.error('[collaboratorService.getSharedEvents] エラー:', error);
      throw error;
    }
  },

  // 招待中のイベント一覧を取得
  async getPendingEvents(email: string): Promise<EventSettings[]> {
    try {
      const eventsRef = collection(db, 'events');
      const q = query(eventsRef, where('pendingCollaboratorEmails', 'array-contains', email.toLowerCase().trim()));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => firestoreToEventSettings(d.id, d.data()));
    } catch (error) {
      console.error('[collaboratorService.getPendingEvents] エラー:', error);
      throw error;
    }
  },

  // オーナー権限移譲を開始（オーナーが実行）
  async initiateOwnerTransfer(eventId: string, targetEmail: string, ownerEmail: string): Promise<void> {
    const eventRef = doc(db, 'events', eventId);
    await updateDoc(eventRef, {
      pendingOwnerEmail: targetEmail.toLowerCase().trim(),
      transferFromOwnerEmail: ownerEmail.toLowerCase().trim(),
      updatedAt: Timestamp.now(),
    });
  },

  // オーナー権限移譲をキャンセル（オーナーが実行）
  async cancelOwnerTransfer(eventId: string): Promise<void> {
    const eventRef = doc(db, 'events', eventId);
    await updateDoc(eventRef, {
      pendingOwnerEmail: '',
      updatedAt: Timestamp.now(),
    });
  },

  // オーナー権限移譲を承認（移譲先ユーザーが実行）
  async acceptOwnerTransfer(eventId: string, newOwnerUid: string, newOwnerEmail: string): Promise<void> {
    const eventRef = doc(db, 'events', eventId);
    await runTransaction(db, async (transaction) => {
      const eventDoc = await transaction.get(eventRef);
      if (!eventDoc.exists()) {
        throw new Error('イベントが見つかりません');
      }
      const data = eventDoc.data();
      console.log('[acceptOwnerTransfer] data:', data);
      console.log('[acceptOwnerTransfer] transferFromOwnerEmail:', data.transferFromOwnerEmail);
      
      if (data.pendingOwnerEmail?.toLowerCase() !== newOwnerEmail.toLowerCase()) {
        throw new Error('この移譲リクエストは無効です');
      }
      
      // 旧オーナーのメールを取得
      const oldOwnerEmail: string = data.transferFromOwnerEmail || '';
      if (!oldOwnerEmail) {
        throw new Error('移譲情報が不完全です。オーナーに移譲をキャンセルして再度開始してもらってください。');
      }
      
      // 新しいオーナーをcollaboratorEmailsから削除し、旧オーナーを追加
      const currentCollaborators: string[] = data.collaboratorEmails || [];
      const updatedCollaborators = currentCollaborators
        .filter((e: string) => e.toLowerCase() !== newOwnerEmail.toLowerCase());
      updatedCollaborators.push(oldOwnerEmail.toLowerCase());
      
      console.log('[acceptOwnerTransfer] updatedCollaborators:', updatedCollaborators);
      
      transaction.update(eventRef, {
        ownerId: newOwnerUid,
        collaboratorEmails: updatedCollaborators,
        pendingOwnerEmail: '',
        transferFromOwnerEmail: '',
        updatedAt: Timestamp.now(),
      });
    });
  },

  // オーナー権限移譲を拒否（移譲先ユーザーが実行）
  async declineOwnerTransfer(eventId: string): Promise<void> {
    const eventRef = doc(db, 'events', eventId);
    await updateDoc(eventRef, {
      pendingOwnerEmail: '',
      updatedAt: Timestamp.now(),
    });
  },
};
