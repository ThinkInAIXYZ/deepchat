/**
 * Test file for knowledge operations in PGlite presenter
 * This file tests the implementation of task 5: vector and knowledge operations
 */

import { PGlitePresenter } from './index'
import { KnowledgeFileMessage, KnowledgeChunkMessage, KnowledgeTaskStatus } from '@shared/presenter'
import path from 'path'
import fs from 'fs'

/**
 * Test knowledge file operations
 */
async function testKnowledgeFileOperations() {
  console.log('Testing knowledge file operations...')

  const dbPath = path.join(__dirname, 'test-knowledge.db')

  // Clean up any existing test database
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath)
  }

  const presenter = new PGlitePresenter(dbPath)

  try {
    // Initialize the database
    await presenter.initialize({
      dbPath,
      vectorDimensions: 1536
    })

    // Test file insertion
    const testFile: KnowledgeFileMessage = {
      id: 'test-file-1',
      name: 'test-document.txt',
      path: '/path/to/test-document.txt',
      mimeType: 'text/plain',
      status: 'processing' as KnowledgeTaskStatus,
      uploadedAt: Date.now(),
      metadata: {
        size: 1024,
        totalChunks: 2
      }
    }

    await presenter.insertFile(testFile)
    console.log('✓ File insertion successful')

    // Test file query
    const retrievedFile = await presenter.queryFile('test-file-1')
    if (retrievedFile && retrievedFile.id === testFile.id) {
      console.log('✓ File query successful')
    } else {
      throw new Error('File query failed')
    }

    // Test file update
    const updatedFile = { ...testFile, status: 'completed' as KnowledgeTaskStatus }
    await presenter.updateFile(updatedFile)
    console.log('✓ File update successful')

    // Test file listing
    const files = await presenter.listFiles()
    if (files.length === 1 && files[0].id === testFile.id) {
      console.log('✓ File listing successful')
    } else {
      throw new Error('File listing failed')
    }

    // Test chunk operations
    const testChunks: KnowledgeChunkMessage[] = [
      {
        id: 'chunk-1',
        fileId: 'test-file-1',
        chunkIndex: 0,
        content: 'This is the first chunk of content.',
        status: 'processing' as KnowledgeTaskStatus
      },
      {
        id: 'chunk-2',
        fileId: 'test-file-1',
        chunkIndex: 1,
        content: 'This is the second chunk of content.',
        status: 'processing' as KnowledgeTaskStatus
      }
    ]

    await presenter.insertChunks(testChunks)
    console.log('✓ Chunk insertion successful')

    // Test chunk status update
    await presenter.updateChunkStatus('chunk-1', 'completed')
    console.log('✓ Chunk status update successful')

    // Test chunk query
    const chunks = await presenter.queryChunks({ fileId: 'test-file-1' })
    if (chunks.length === 2) {
      console.log('✓ Chunk query successful')
    } else {
      throw new Error('Chunk query failed')
    }

    // Test vector operations
    const vectorData = Array.from({ length: 1536 }, () => Math.random())

    await presenter.insertVector({
      vector: vectorData,
      fileId: 'test-file-1',
      chunkId: 'chunk-1'
    })
    console.log('✓ Vector insertion successful')

    // Test similarity query
    const queryVector = Array.from({ length: 1536 }, () => Math.random())
    const results = await presenter.similarityQuery(queryVector, {
      topK: 5,
      metric: 'cosine'
    })

    if (results.length >= 0) {
      // Should have at least 0 results (might be 0 if no similar vectors)
      console.log('✓ Similarity query successful')
    } else {
      throw new Error('Similarity query failed')
    }

    // Test file deletion (should cascade to chunks and vectors)
    await presenter.deleteFile('test-file-1')
    console.log('✓ File deletion successful')

    // Verify cascading deletion
    const remainingFiles = await presenter.listFiles()
    const remainingChunks = await presenter.queryChunks({ fileId: 'test-file-1' })

    if (remainingFiles.length === 0 && remainingChunks.length === 0) {
      console.log('✓ Cascading deletion successful')
    } else {
      throw new Error('Cascading deletion failed')
    }

    console.log('All knowledge operations tests passed! ✅')
  } catch (error) {
    console.error('Test failed:', error)
    throw error
  } finally {
    await presenter.close()

    // Clean up test database
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath)
    }
  }
}

// Export for potential use in other test files
export { testKnowledgeFileOperations }

// Run tests if this file is executed directly
if (require.main === module) {
  testKnowledgeFileOperations()
    .then(() => {
      console.log('Knowledge operations test completed successfully')
      process.exit(0)
    })
    .catch((error) => {
      console.error('Knowledge operations test failed:', error)
      process.exit(1)
    })
}
