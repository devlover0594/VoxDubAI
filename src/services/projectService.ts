import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  DubSegment,
  SavedDubbingProject,
  SubtitleStyle,
  VoiceStyle,
} from '../types/dubbing';
import { sanitizeSegmentsForFirestore } from '../utils/subtitleUtils';

export async function syncUserProfile(user: User): Promise<void> {
  const userRef = doc(db, 'users', user.uid);
  const path = `users/${user.uid}`;
  try {
    const snap = await getDoc(userRef);
    const displayName = (user.displayName || user.email || 'Pengguna VoxDub').slice(0, 120);
    const email = (user.email || '').slice(0, 254);
    const photoURL = user.photoURL ? user.photoURL.slice(0, 512) : undefined;

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName,
        email,
        ...(photoURL ? { photoURL } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName,
        email,
        ...(photoURL ? { photoURL } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeUserProjects(
  ownerId: string,
  onProjects: (projects: SavedDubbingProject[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const projectsRef = collection(db, 'projects');
  const q = query(
    projectsRef,
    where('ownerId', '==', ownerId),
    orderBy('updatedAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: SavedDubbingProject[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ownerId),
          title: String(data.title ?? 'Proyek Tanpa Judul'),
          sourceLanguage: String(data.sourceLanguage ?? 'auto'),
          targetLanguage: String(data.targetLanguage ?? 'id'),
          voiceStyle: (data.voiceStyle as VoiceStyle) || 'male_pro',
          durationSeconds: Number(data.durationSeconds ?? 0),
          subtitleStyle: {
            fontSize: data.subtitleStyle?.fontSize ?? 'lg',
            textColor: data.subtitleStyle?.textColor ?? '#FFFFFF',
            backgroundEnabled: Boolean(data.subtitleStyle?.backgroundEnabled ?? true),
            backgroundOpacity: Number(data.subtitleStyle?.backgroundOpacity ?? 0.75),
            dynamicMode: data.subtitleStyle?.dynamicMode ?? 'classic',
          },
          segments: Array.isArray(data.segments) ? data.segments : [],
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });
      onProjects(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'projects');
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export interface SaveProjectInput {
  projectId?: string | null;
  ownerId: string;
  title: string;
  sourceLanguage: string;
  targetLanguage: string;
  voiceStyle: VoiceStyle;
  durationSeconds: number;
  subtitleStyle: SubtitleStyle;
  segments: DubSegment[];
}

export async function saveDubbingProject(input: SaveProjectInput): Promise<string> {
  const id =
    input.projectId && /^[a-zA-Z0-9_\-]+$/.test(input.projectId)
      ? input.projectId.slice(0, 128)
      : `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const projectRef = doc(db, 'projects', id);
  const path = `projects/${id}`;

  const safeTitle = (input.title || 'Proyek VoxDub AI').trim().slice(0, 180) || 'Proyek VoxDub AI';
  const safeSegments = sanitizeSegmentsForFirestore(input.segments);

  const safeSubtitleStyle: SubtitleStyle = {
    fontSize: input.subtitleStyle.fontSize,
    textColor: input.subtitleStyle.textColor.slice(0, 16),
    backgroundEnabled: Boolean(input.subtitleStyle.backgroundEnabled),
    backgroundOpacity: Math.max(0, Math.min(1, Number(input.subtitleStyle.backgroundOpacity) || 0.75)),
    dynamicMode: input.subtitleStyle.dynamicMode || 'classic',
  };

  try {
    const existingSnap = await getDoc(projectRef);
    if (!existingSnap.exists()) {
      await setDoc(projectRef, {
        id,
        ownerId: input.ownerId,
        title: safeTitle,
        sourceLanguage: input.sourceLanguage.slice(0, 16),
        targetLanguage: input.targetLanguage.slice(0, 16),
        voiceStyle: input.voiceStyle,
        durationSeconds: Math.max(0, Math.min(86400, Number(input.durationSeconds) || 0)),
        subtitleStyle: safeSubtitleStyle,
        segments: safeSegments,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(projectRef, {
        title: safeTitle,
        sourceLanguage: input.sourceLanguage.slice(0, 16),
        targetLanguage: input.targetLanguage.slice(0, 16),
        voiceStyle: input.voiceStyle,
        durationSeconds: Math.max(0, Math.min(86400, Number(input.durationSeconds) || 0)),
        subtitleStyle: safeSubtitleStyle,
        segments: safeSegments,
        updatedAt: serverTimestamp(),
      });
    }
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteDubbingProject(projectId: string): Promise<void> {
  const path = `projects/${projectId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
