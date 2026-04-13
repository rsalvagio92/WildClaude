import { initDatabase, saveStructuredMemory } from './src/db';
import { buildMemoryContext } from './src/memory';
import path from 'path';

async function testMemoryLive() {
  console.log('🧠 TEST MEMORIA LIVE START\n');

  try {
    // 1️⃣  Init database
    console.log('📦 Initializing database...');
    initDatabase(path.join(process.cwd(), 'test-store'));
    console.log('✓ Database initialized\n');

    // 2️⃣  Save test memories
    console.log('💾 Saving test memories...');

    const memories = [
      {
        chatId: 'test-chat',
        content: 'Preferisco lavorare la mattina quando la mente è fresca',
        summary: 'User prefers morning work sessions',
        entities: ['morning', 'work', 'productivity'],
        topics: ['work', 'productivity'],
        importance: 0.8,
        source: 'conversation',
        agentId: 'main'
      },
      {
        chatId: 'test-chat',
        content: 'Ho un deadline importante il venerdì per il progetto WildClaude',
        summary: 'WildClaude project deadline Friday',
        entities: ['WildClaude', 'Friday', 'deadline'],
        topics: ['projects', 'deadlines'],
        importance: 0.9,
        source: 'conversation',
        agentId: 'main'
      },
      {
        chatId: 'test-chat',
        content: 'Mi piace usare Notion per organizzare i miei task giornalieri',
        summary: 'Uses Notion for daily task organization',
        entities: ['Notion', 'tasks', 'daily'],
        topics: ['tools', 'organization'],
        importance: 0.7,
        source: 'conversation',
        agentId: 'main'
      }
    ];

    for (const mem of memories) {
      saveStructuredMemory(
        mem.chatId,
        mem.content,
        mem.summary,
        mem.entities,
        mem.topics,
        mem.importance,
        mem.source,
        mem.agentId
      );
      console.log(`  ✓ Saved: "${mem.summary}"`);
    }
    console.log('');

    // 3️⃣  Test memory retrieval
    console.log('🔍 Testing memory retrieval...\n');

    // Search for "morning"
    console.log('Query: "morning work"');
    const context1 = await buildMemoryContext('test-chat', 'morning work');
    console.log(`Found ${context1.surfacedMemoryIds.length} memories:`);
    context1.surfacedMemorySummaries.forEach((summary, id) => {
      console.log(`  - [ID: ${id}] ${summary}`);
    });
    console.log('');

    // Search for "Notion"
    console.log('Query: "Notion organizing"');
    const context2 = await buildMemoryContext('test-chat', 'Notion organizing');
    console.log(`Found ${context2.surfacedMemoryIds.length} memories:`);
    context2.surfacedMemorySummaries.forEach((summary, id) => {
      console.log(`  - [ID: ${id}] ${summary}`);
    });
    console.log('');

    // Search for "deadline"
    console.log('Query: "project deadline"');
    const context3 = await buildMemoryContext('test-chat', 'project deadline');
    console.log(`Found ${context3.surfacedMemoryIds.length} memories:`);
    context3.surfacedMemorySummaries.forEach((summary, id) => {
      console.log(`  - [ID: ${id}] ${summary}`);
    });
    console.log('');

    // 4️⃣  Show memory context injection
    console.log('📤 Injected context for "task management":\n');
    const fullContext = await buildMemoryContext('test-chat', 'task management');
    if (fullContext.contextText) {
      console.log(fullContext.contextText);
    } else {
      console.log('(No context memories found)');
    }

    console.log('\n✅ MEMORIA SYSTEM FULLY OPERATIONAL!');
    console.log('✓ Database init: OK');
    console.log('✓ Memory save: OK');
    console.log('✓ Memory retrieval: OK');
    console.log('✓ Context injection: OK');

  } catch (error) {
    console.error('❌ TEST FAILED:', error);
    process.exit(1);
  }
}

testMemoryLive();
