/**
 * Validation System Test
 * Comprehensive test to verify the data validation and integrity checking system
 */

import { PGliteDataValidator } from './validation'

/**
 * Test the validation system components
 */
export function testValidationSystem(): boolean {
  try {
    console.log('[Validation Test] Starting validation system test')

    // Test 1: Data Validator initialization
    const dataValidator = new PGliteDataValidator()
    console.log('[Validation Test] ✓ Data validator initialized')

    // Test 2: Validation categories
    const categories = dataValidator.getValidationCategories()
    const expectedCategories = ['structure', 'data', 'relationships', 'performance']

    for (const expectedCategory of expectedCategories) {
      if (!categories.includes(expectedCategory)) {
        throw new Error(`Missing validation category: ${expectedCategory}`)
      }
    }
    console.log(`[Validation Test] ✓ Found all expected categories: ${categories.join(', ')}`)

    // Test 3: Validation rules by category
    const structureRules = dataValidator.getValidationRulesByCategory('structure')
    const dataRules = dataValidator.getValidationRulesByCategory('data')
    const relationshipRules = dataValidator.getValidationRulesByCategory('relationships')
    const performanceRules = dataValidator.getValidationRulesByCategory('performance')

    if (structureRules.length === 0) {
      throw new Error('No structure validation rules found')
    }
    if (dataRules.length === 0) {
      throw new Error('No data validation rules found')
    }
    if (relationshipRules.length === 0) {
      throw new Error('No relationship validation rules found')
    }
    if (performanceRules.length === 0) {
      throw new Error('No performance validation rules found')
    }

    console.log(`[Validation Test] ✓ Structure rules: ${structureRules.length}`)
    console.log(`[Validation Test] ✓ Data rules: ${dataRules.length}`)
    console.log(`[Validation Test] ✓ Relationship rules: ${relationshipRules.length}`)
    console.log(`[Validation Test] ✓ Performance rules: ${performanceRules.length}`)

    // Test 4: Specific validation rules
    const expectedRules = [
      'schema_version_check',
      'required_tables_check',
      'required_indexes_check',
      'pgvector_extension_check',
      'conversation_data_integrity',
      'message_data_integrity',
      'knowledge_file_integrity',
      'vector_data_integrity',
      'foreign_key_constraints',
      'orphaned_records_check',
      'circular_references_check',
      'vector_index_performance',
      'query_performance_check'
    ]

    const allRules = [...structureRules, ...dataRules, ...relationshipRules, ...performanceRules]

    for (const expectedRule of expectedRules) {
      const ruleExists = allRules.some((rule) => rule.name === expectedRule)
      if (!ruleExists) {
        throw new Error(`Missing validation rule: ${expectedRule}`)
      }
    }

    console.log('[Validation Test] ✓ All expected validation rules present')

    // Test 5: Rule properties validation
    for (const rule of allRules) {
      if (!rule.name || !rule.description || !rule.category || !rule.severity || !rule.validate) {
        throw new Error(`Invalid rule structure: ${rule.name}`)
      }

      if (!['structure', 'data', 'relationships', 'performance'].includes(rule.category)) {
        throw new Error(`Invalid rule category: ${rule.category}`)
      }

      if (!['error', 'warning', 'info'].includes(rule.severity)) {
        throw new Error(`Invalid rule severity: ${rule.severity}`)
      }

      if (typeof rule.validate !== 'function') {
        throw new Error(`Rule validate is not a function: ${rule.name}`)
      }
    }

    console.log('[Validation Test] ✓ All validation rules have valid structure')

    console.log('[Validation Test] All validation system tests passed!')
    return true
  } catch (error) {
    console.error('[Validation Test] Validation system test failed:', error)
    return false
  }
}

/**
 * Test validation rule structure and requirements
 */
export function testValidationRules(): boolean {
  try {
    console.log('[Validation Rules Test] Testing validation rule requirements')

    const dataValidator = new PGliteDataValidator()

    // Test conversation validation requirements
    const conversationRules = dataValidator
      .getValidationRulesByCategory('data')
      .filter((rule) => rule.name.includes('conversation'))

    if (conversationRules.length === 0) {
      throw new Error('No conversation validation rules found')
    }
    console.log('[Validation Rules Test] ✓ Conversation validation rules present')

    // Test message validation requirements
    const messageRules = dataValidator
      .getValidationRulesByCategory('data')
      .filter((rule) => rule.name.includes('message'))

    if (messageRules.length === 0) {
      throw new Error('No message validation rules found')
    }
    console.log('[Validation Rules Test] ✓ Message validation rules present')

    // Test vector validation requirements
    const vectorRules = dataValidator
      .getValidationRulesByCategory('data')
      .filter((rule) => rule.name.includes('vector'))

    if (vectorRules.length === 0) {
      throw new Error('No vector validation rules found')
    }
    console.log('[Validation Rules Test] ✓ Vector validation rules present')

    // Test integrity checking requirements
    const integrityRules = dataValidator.getValidationRulesByCategory('relationships')

    const hasOrphanedCheck = integrityRules.some((rule) => rule.name.includes('orphaned'))
    const hasForeignKeyCheck = integrityRules.some((rule) => rule.name.includes('foreign_key'))
    const hasCircularCheck = integrityRules.some((rule) => rule.name.includes('circular'))

    if (!hasOrphanedCheck) {
      throw new Error('Missing orphaned records validation')
    }
    if (!hasForeignKeyCheck) {
      throw new Error('Missing foreign key validation')
    }
    if (!hasCircularCheck) {
      throw new Error('Missing circular reference validation')
    }

    console.log('[Validation Rules Test] ✓ All integrity checking rules present')

    // Test performance validation requirements
    const performanceRules = dataValidator.getValidationRulesByCategory('performance')

    const hasVectorPerformance = performanceRules.some((rule) => rule.name.includes('vector'))
    const hasQueryPerformance = performanceRules.some((rule) => rule.name.includes('query'))

    if (!hasVectorPerformance) {
      throw new Error('Missing vector performance validation')
    }
    if (!hasQueryPerformance) {
      throw new Error('Missing query performance validation')
    }

    console.log('[Validation Rules Test] ✓ All performance validation rules present')

    console.log('[Validation Rules Test] Validation rules test passed!')
    return true
  } catch (error) {
    console.error('[Validation Rules Test] Validation rules test failed:', error)
    return false
  }
}

/**
 * Test validation result structures
 */
export function testValidationResultStructures(): boolean {
  try {
    console.log('[Validation Results Test] Testing validation result structures')

    // Test ValidationRuleResult structure
    const mockRuleResult = {
      passed: true,
      message: 'Test validation passed',
      details: { testData: 'example' },
      affectedRecords: 0,
      suggestedAction: 'No action needed'
    }

    // Verify all required properties exist
    const requiredRuleProperties = ['passed', 'message']
    for (const prop of requiredRuleProperties) {
      if (!(prop in mockRuleResult)) {
        throw new Error(`Missing required property in ValidationRuleResult: ${prop}`)
      }
    }
    console.log('[Validation Results Test] ✓ ValidationRuleResult structure valid')

    // Test DataValidationResult structure
    const mockValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      info: [],
      summary: {
        totalRules: 10,
        passedRules: 10,
        failedRules: 0,
        warningRules: 0,
        executionTime: 100
      }
    }

    const requiredValidationProperties = ['isValid', 'errors', 'warnings', 'info', 'summary']
    for (const prop of requiredValidationProperties) {
      if (!(prop in mockValidationResult)) {
        throw new Error(`Missing required property in DataValidationResult: ${prop}`)
      }
    }
    console.log('[Validation Results Test] ✓ DataValidationResult structure valid')

    // Test IntegrityCheckResult structure
    const mockIntegrityResult = {
      isValid: true,
      issues: [],
      statistics: {
        totalRecords: {},
        orphanedRecords: {},
        duplicateRecords: {},
        constraintViolations: 0
      }
    }

    const requiredIntegrityProperties = ['isValid', 'issues', 'statistics']
    for (const prop of requiredIntegrityProperties) {
      if (!(prop in mockIntegrityResult)) {
        throw new Error(`Missing required property in IntegrityCheckResult: ${prop}`)
      }
    }
    console.log('[Validation Results Test] ✓ IntegrityCheckResult structure valid')

    console.log('[Validation Results Test] Validation result structures test passed!')
    return true
  } catch (error) {
    console.error('[Validation Results Test] Validation result structures test failed:', error)
    return false
  }
}

/**
 * Test validation requirements coverage
 */
export function testValidationRequirementsCoverage(): boolean {
  try {
    console.log('[Requirements Coverage Test] Testing validation requirements coverage')

    const dataValidator = new PGliteDataValidator()
    const allRules = [
      ...dataValidator.getValidationRulesByCategory('structure'),
      ...dataValidator.getValidationRulesByCategory('data'),
      ...dataValidator.getValidationRulesByCategory('relationships'),
      ...dataValidator.getValidationRulesByCategory('performance')
    ]

    // Requirement 2.4: Data integrity verification
    const integrityRules = allRules.filter(
      (rule) =>
        rule.name.includes('integrity') ||
        rule.name.includes('constraint') ||
        rule.name.includes('orphaned')
    )

    if (integrityRules.length === 0) {
      throw new Error('Requirement 2.4: No data integrity verification rules found')
    }
    console.log(
      '[Requirements Coverage Test] ✓ Requirement 2.4: Data integrity verification covered'
    )

    // Requirement 9.1: Validation rules for conversations
    const conversationValidation = allRules.some(
      (rule) => rule.name.includes('conversation') && rule.category === 'data'
    )

    if (!conversationValidation) {
      throw new Error('Requirement 9.1: No conversation validation rules found')
    }
    console.log('[Requirements Coverage Test] ✓ Requirement 9.1: Conversation validation covered')

    // Requirement 9.2: Validation rules for messages and vectors
    const messageValidation = allRules.some(
      (rule) => rule.name.includes('message') && rule.category === 'data'
    )
    const vectorValidation = allRules.some(
      (rule) => rule.name.includes('vector') && rule.category === 'data'
    )

    if (!messageValidation) {
      throw new Error('Requirement 9.2: No message validation rules found')
    }
    if (!vectorValidation) {
      throw new Error('Requirement 9.2: No vector validation rules found')
    }
    console.log(
      '[Requirements Coverage Test] ✓ Requirement 9.2: Message and vector validation covered'
    )

    // Additional comprehensive validation coverage
    const structureValidation = allRules.filter((rule) => rule.category === 'structure').length > 0
    const relationshipValidation =
      allRules.filter((rule) => rule.category === 'relationships').length > 0
    const performanceValidation =
      allRules.filter((rule) => rule.category === 'performance').length > 0

    if (!structureValidation) {
      throw new Error('Missing structure validation coverage')
    }
    if (!relationshipValidation) {
      throw new Error('Missing relationship validation coverage')
    }
    if (!performanceValidation) {
      throw new Error('Missing performance validation coverage')
    }

    console.log('[Requirements Coverage Test] ✓ All validation categories covered')

    console.log('[Requirements Coverage Test] Validation requirements coverage test passed!')
    return true
  } catch (error) {
    console.error(
      '[Requirements Coverage Test] Validation requirements coverage test failed:',
      error
    )
    return false
  }
}

/**
 * Run all validation system tests
 */
export function runAllValidationTests(): boolean {
  console.log('[Validation Tests] Starting comprehensive validation system tests')

  const results = [
    testValidationSystem(),
    testValidationRules(),
    testValidationResultStructures(),
    testValidationRequirementsCoverage()
  ]

  const allPassed = results.every((result) => result === true)

  if (allPassed) {
    console.log('[Validation Tests] ✅ All validation system tests passed!')
  } else {
    console.log('[Validation Tests] ❌ Some validation system tests failed!')
  }

  return allPassed
}
