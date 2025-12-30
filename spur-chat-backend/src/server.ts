import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Groq } from 'groq-sdk';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize SQLite database
const db = new Database('./chat.db');

// Initialize Groq with your FREE API key
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json());

// Type definitions for database results
interface MessageRow {
  id: string;
  conversation_id: string;
  sender: 'user' | 'ai';
  text: string;
  created_at: string;
}

interface ConversationRow {
  id: string;
  created_at: string;
}

// Create database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation 
  ON messages(conversation_id, created_at);
`);

// Store information for the AI agent
const STORE_INFO = `You are "Alex", a friendly and helpful customer support agent for QuickShop e-commerce store.

IMPORTANT GUIDELINES:
1. Be conversational and natural - don't sound like a robot
2. Greet customers warmly when they say hello
3. Only share store information when asked
4. Keep responses concise but helpful

STORE INFORMATION (share when relevant):
- **Returns**: 30-day return policy. Items must be unused with original tags.
- **Shipping**: Free shipping on orders over $50. Standard: 5-7 business days.
- **Support Hours**: Monday-Friday, 9:00 AM - 6:00 PM EST
- **Contact**: support@quickshop.com or call 1-800-QUICK-SHOP
- **Payment**: We accept Visa, Mastercard, Amex, PayPal, Apple Pay

Be helpful, friendly, and professional.`;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'QuickShop Support Chat API',
    model: 'llama-3.1-8b-instant'
  });
});

// Create new conversation
app.post('/api/conversation', (req, res) => {
  try {
    const conversationId = uuidv4();
    const stmt = db.prepare('INSERT INTO conversations (id) VALUES (?)');
    stmt.run(conversationId);
    
    res.json({ 
      success: true, 
      conversationId,
      message: 'New conversation started'
    });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Main chat endpoint
app.post('/api/message', async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    
    // Input validation
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required and must be a string' });
    }
    
    const userMessage = message.trim();
    
    if (userMessage.length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    
    if (userMessage.length > 1000) {
      return res.status(400).json({ 
        error: 'Message too long (maximum 1000 characters)',
        length: userMessage.length 
      });
    }
    
    // Get or create conversation
    let convId = conversationId;
    let isNewConversation = false;
    
    if (!convId) {
      convId = uuidv4();
      const stmt = db.prepare('INSERT INTO conversations (id) VALUES (?)');
      stmt.run(convId);
      isNewConversation = true;
    } else {
      // Verify conversation exists
      const exists = db.prepare('SELECT id FROM conversations WHERE id = ?').get(convId) as ConversationRow | undefined;
      if (!exists) {
        convId = uuidv4();
        db.prepare('INSERT INTO conversations (id) VALUES (?)').run(convId);
        isNewConversation = true;
      }
    }
    
    // Save user message
    const userMsgId = uuidv4();
    const saveUserMsg = db.prepare(
      'INSERT INTO messages (id, conversation_id, sender, text) VALUES (?, ?, ?, ?)'
    );
    saveUserMsg.run(userMsgId, convId, 'user', userMessage);
    
    // Get conversation history (last 6 messages for context)
    const history = (db.prepare(
      `SELECT sender, text 
       FROM messages 
       WHERE conversation_id = ? 
       ORDER BY created_at DESC 
       LIMIT 6`
    ).all(convId) as { sender: 'user' | 'ai'; text: string }[]).reverse();
    
    // Build messages array for Groq
    const messages: any[] = [
      { role: 'system', content: STORE_INFO }
    ];
    
    // Add conversation history
    history.forEach(msg => {
      messages.push({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.text
      });
    });
    
    // Add current user message
    messages.push({ role: 'user', content: userMessage });
    
    console.log(`Sending to Groq: "${userMessage.substring(0, 50)}..."`);
    
    // Call Groq API - TRY DIFFERENT MODELS HERE
    let aiReply = '';
    let modelUsed = '';
    
    // Try models in order until one works
    const modelsToTry = [
      'llama-3.1-8b-instant',      // Most likely to work
      'llama-3.2-3b-preview',      // Alternative 1
      'gemma2-9b-it',              // Alternative 2
      'llama-3.2-1b-preview',      // Alternative 3
    ];
    
    let lastError: any = null;
    
    for (const model of modelsToTry) {
      try {
        console.log(`Trying model: ${model}`);
        modelUsed = model;
        
        const chatCompletion = await groq.chat.completions.create({
          messages,
          model: model,
          temperature: 0.7,
          max_tokens: 250,
          top_p: 0.9,
          frequency_penalty: 0.5,
        });
        
        aiReply = chatCompletion.choices[0]?.message?.content || 
                 "I apologize, but I couldn't generate a response.";
        break; // Exit loop on success
        
      } catch (error: any) {
        lastError = error;
        console.log(`Model ${model} failed: ${error?.error?.message || error.message}`);
        continue; // Try next model
      }
    }
    
    if (!aiReply) {
      throw lastError || new Error('All models failed');
    }
    
    // Save AI response
    const aiMsgId = uuidv4();
    const saveAiMsg = db.prepare(
      'INSERT INTO messages (id, conversation_id, sender, text) VALUES (?, ?, ?, ?)'
    );
    saveAiMsg.run(aiMsgId, convId, 'ai', aiReply);
    
    // Send response
    res.json({
      success: true,
      reply: aiReply,
      conversationId: convId,
      modelUsed: modelUsed,
      isNewConversation,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('Chat error:', error?.message || error);
    
    let errorMessage = 'Sorry, I encountered an error. Please try again.';
    let statusCode = 500;
    
    if (error?.status === 401) {
      errorMessage = 'API authentication failed. Please check your Groq API key.';
      statusCode = 401;
    } else if (error?.status === 429) {
      errorMessage = 'Too many requests. Please try again in a moment.';
      statusCode = 429;
    } else if (error?.status === 400) {
      errorMessage = 'Model issue. Trying alternative approach...';
      // Fallback to mock response
      errorMessage = 'Service updating. Here is sample response: We have a 30-day return policy for items in original condition.';
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      reply: "I'm having temporary technical issues. Our return policy is 30 days for items in original condition.",
      fallback: true
    });
  }
});

// Get conversation history
app.get('/api/conversation/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if conversation exists
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    // Get all messages for this conversation
    const messages = db.prepare(
      `SELECT id, sender, text, created_at 
       FROM messages 
       WHERE conversation_id = ? 
       ORDER BY created_at ASC`
    ).all(id) as MessageRow[];
    
    res.json({
      success: true,
      conversationId: id,
      createdAt: conversation.created_at,
      messageCount: messages.length,
      messages
    });
    
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to retrieve conversation history' });
  }
});

// Export conversation as JSON for download or client consumption
// NOTE: This endpoint is intentionally simple. In a prod app you'd want auth and rate-limiting.
app.get('/api/conversation/:id/export', (req, res) => {
  try {
    const { id } = req.params;
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = db.prepare(
      `SELECT id, sender, text, created_at 
       FROM messages 
       WHERE conversation_id = ? 
       ORDER BY created_at ASC`
    ).all(id) as MessageRow[];

    const payload = {
      conversationId: id,
      createdAt: conversation.created_at,
      messageCount: messages.length,
      messages
    };

    // Provide a downloadable file for convenience; clients can also use the JSON
    // We send JSON and set an attachment header. Clients can use either behavior.
    res.setHeader('Content-Disposition', `attachment; filename="conversation-${id}.json"`);
    res.type('application/json').send(JSON.stringify(payload, null, 2));

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export conversation' });
  }
});

// Delete a conversation (and its messages via cascade)
app.delete('/api/conversation/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Delete the conversation (messages have ON DELETE CASCADE)
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);

    // Extra verification step - slightly paranoid but helps debugging
    const leftover = db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?').get(id);
    console.log(`Deleted conversation ${id}, leftover messages: ${((leftover as any)?.cnt) || 0}`);

    res.json({ success: true, conversationId: id });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// List all conversations (simple endpoint, not paginated)
app.get('/api/conversations', (req, res) => {
  try {
    // Note: this is slightly inefficient (runs a count per conversation), but it's ok for small apps
    const rows = db.prepare('SELECT id, created_at FROM conversations ORDER BY created_at DESC').all() as ConversationRow[];
    const conversations = rows.map(r => {
      // small extra query per row - could be optimized with a JOIN in prod
      const cntRow = db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?').get(r.id) as any;
      return {
        id: r.id,
        createdAt: r.created_at,
        messageCount: (cntRow && cntRow.cnt) ? cntRow.cnt : 0
      };
    });

    res.json({ success: true, conversations });
  } catch (error) {
    console.error('List conversations error:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`QuickShop Support Chat API is running!`);
  console.log(` Local: http://localhost:${PORT}`);
  console.log(` Using Groq - will try available models`);
  console.log(` Health check: http://localhost:${PORT}/health`);
  console.log(` Available models: llama-3.1-8b-instant, llama-3.2-3b-preview, gemma2-9b-it`);
});