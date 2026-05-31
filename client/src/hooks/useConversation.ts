import { useState } from 'react';
import { Platform } from 'react-native';
import { useConversationStore } from '../store/conversationStore';
import { useAuthStore } from '../store/authStore';
import { api } from '../lib/api';
import { Conversation, ConversationUploadResponse } from '../types';

// Cross-platform alert that works on web and native
const showAlert = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}: ${message}`);
  } else {
    // Dynamic import to avoid web bundling issues
    const { Alert } = require('react-native');
    Alert.alert(title, message);
  }
};

export function useConversation() {
  const {
    conversations,
    activeConversation,
    activeTranscript,
    activeAiResponse,
    activeTasks,
    activeMood,
    setConversations,
    setActiveConversation,
    setActiveTranscript,
    setActiveAiResponse,
    setActiveTasks,
    setActiveMood,
    clearActiveSession,
  } = useConversationStore();

  const [loading, setLoading] = useState(false);

  const fetchConversations = async () => {
    setLoading(true);
    try {
      const response = await api.get<Conversation[]>('/conversations');
      setConversations(response.data);
    } catch (err: any) {
      console.warn('API /conversations failed', err.message);
      showAlert('Error', 'Could not fetch your history. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const uploadConversation = async (
    uri: string,
    flowType: 'brain_dump' | 'quick_vent' | 'morning_checkin',
    durationSeconds: number
  ): Promise<boolean> => {
    setLoading(true);
    clearActiveSession();

    try {
      // Prepare FormData
      const formData = new FormData();
      
      // Determine file extension and type
      const fileExt = uri.split('.').pop() || 'm4a';
      let mimeType = 'audio/m4a';
      if (fileExt === 'webm') mimeType = 'audio/webm';
      else if (fileExt === 'mp4') mimeType = 'audio/mp4';

      // Append the audio file
      formData.append('audio', {
        uri,
        name: `recording.${fileExt}`,
        type: mimeType,
      } as any);

      // Append metadata
      formData.append('flowType', flowType);
      formData.append('durationSeconds', durationSeconds.toString());

      console.log(`Uploading ${flowType} conversation (${durationSeconds}s)...`);

      // Make the actual API call
      // We must configure headers for multipart/form-data
      const response = await api.post('/conversations', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const responseData = response.data;

      setActiveConversation(responseData.conversation);
      setActiveTranscript(responseData.transcript);
      setActiveAiResponse(responseData.aiResponse);
      setActiveTasks(responseData.tasks);
      setActiveMood(responseData.mood);

      // Prepend new conversation to list
      setConversations([responseData.conversation, ...conversations]);
      return true;

    } catch (err: any) {
      console.error('Audio upload failed or server offline.', err.message);
      showAlert('Processing Error', 'Failed to process audio. Please try again.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const deleteConversation = async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      await api.delete(`/conversations/${id}`);
      setConversations(conversations.filter((c) => c.id !== id));
      if (activeConversation?.id === id) {
        clearActiveSession();
        setActiveConversation(null);
      }
      return true;
    } catch (err: any) {
      console.warn('API delete failed', err.message);
      showAlert('Error', 'Failed to delete session.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  return {
    conversations,
    activeConversation,
    activeTranscript,
    activeAiResponse,
    activeTasks,
    activeMood,
    loading,
    fetchConversations,
    uploadConversation,
    deleteConversation,
    clearActiveSession,
  };
}
