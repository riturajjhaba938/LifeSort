import { prisma } from '../config/prisma.js';
import { TEEService } from '../services/teeService.js';
import { transcribeAudio } from '../services/whisperService.js';
import { llmOrchestrator } from '../services/llmOrchestrator.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
export const uploadConversation = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Since we're using memoryStorage in Multer (for MVP simplicity without external buckets),
    // we need to temporarily write to disk for OpenAI API or switch to Buffer uploads.
    // For now, write a temp file.
    const ext = req.file.originalname?.split('.').pop() || 'webm';
    const tempFilePath = path.join(os.tmpdir(), `${req.user.id}_${Date.now()}.${ext}`);
    fs.writeFileSync(tempFilePath, req.file.buffer);

    // 1. Whisper STT
    const transcript = await transcribeAudio(tempFilePath);
    
    // Clean up temp file
    fs.unlinkSync(tempFilePath);

    // 2. LLM Orchestration
    const aiResult = await llmOrchestrator.processConversation(transcript);

    // 3. Save to DB with TEE Encryption
    const dbUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { encryptionSalt: true }
    });

    if (!dbUser || !dbUser.encryptionSalt) {
      throw new Error('User encryption configuration not found. Please re-sync your profile.');
    }

    const { encrypted: encryptedTranscript } = await TEEService.secureProcess(
      req.user.id, 
      dbUser.encryptionSalt, 
      transcript, 
      (data) => data // Identity function, we just want the encryption part
    );

    // Create tasks
    const tasks = aiResult.entities.tasks || [];
    
    // Create the conversation in DB
    const conversation = await prisma.conversation.create({
      data: {
        userId: req.user.id,
        flowType: 'brain_dump',
        encryptedTranscript: Buffer.from(encryptedTranscript), // Store encrypted text
        overallSentiment: parseFloat(aiResult.emotions.score),
        categories: aiResult.entities.categories || [],
        
        // Nested creates
        tasks: {
          create: tasks.map(t => ({
            userId: req.user.id,
            title: t.title,
            description: t.description,
            priority: t.priority || 'medium',
            dueDate: t.dueDate ? new Date(t.dueDate) : null
          }))
        },
        moodEntries: {
          create: {
            userId: req.user.id,
            score: parseFloat(aiResult.emotions.score),
            emotions: aiResult.emotions.emotions,
            triggers: aiResult.emotions.triggers,
            notes: aiResult.emotions.notes
          }
        }
      },
      include: { tasks: true, moodEntries: true }
    });

    res.status(201).json({
      conversation: {
        id: conversation.id,
        userId: conversation.userId,
        title: aiResult.entities.title || `${req.body.flowType} Session`,
        encryptedTranscript: '',
        summary: aiResult.assistantResponse.slice(0, 120),
        flowType: conversation.flowType,
        durationSeconds: parseInt(req.body.durationSeconds) || 0,
        overallSentiment: conversation.overallSentiment,
        categories: conversation.categories,
        createdAt: conversation.createdAt.toISOString(),
      },
      transcript: transcript,
      aiResponse: aiResult.assistantResponse,
      tasks: conversation.tasks.map(t => ({
        id: t.id, userId: t.userId, title: t.title,
        description: t.description, category: t.category,
        priority: t.priority, status: t.status,
        dueDate: t.dueDate?.toISOString(), people: t.people || [],
        createdAt: t.createdAt.toISOString(),
      })),
      mood: conversation.moodEntries[0] ? {
        id: conversation.moodEntries[0].id,
        userId: conversation.moodEntries[0].userId,
        score: conversation.moodEntries[0].score,
        emotions: conversation.moodEntries[0].emotions,
        triggers: conversation.moodEntries[0].triggers,
        notes: conversation.moodEntries[0].notes,
        createdAt: conversation.moodEntries[0].createdAt.toISOString(),
      } : null,
    });
  } catch (error) {
    next(error);
  }
};

export const getConversations = async (req, res, next) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json(conversations.map(c => ({
      id: c.id, userId: c.userId, title: c.title,
      encryptedTranscript: '', summary: c.summary,
      flowType: c.flowType, durationSeconds: c.durationSeconds,
      overallSentiment: c.overallSentiment, categories: c.categories,
      createdAt: c.createdAt.toISOString(),
    })));
  } catch (error) {
    next(error);
  }
};

export const getConversationById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findUnique({
      where: { id, userId: req.user.id }
    });

    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    res.status(200).json({ status: 'success', data: conversation });
  } catch (error) {
    next(error);
  }
};

export const deleteConversation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation || conversation.userId !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    // Delete related records first (cascading)
    await prisma.moodEntry.deleteMany({ where: { conversationId: id } });
    await prisma.reminder.deleteMany({ where: { task: { conversationId: id } } });
    await prisma.task.deleteMany({ where: { conversationId: id } });
    await prisma.conversation.delete({ where: { id } });
    res.status(200).json({ status: 'deleted' });
  } catch (error) {
    next(error);
  }
};
