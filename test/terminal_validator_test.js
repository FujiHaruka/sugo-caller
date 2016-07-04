/**
 * Test case for terminalValidator.
 * Runs with mocha.
 */
'use strict'

const TerminalValidator = require('../lib/validating/terminal_validator.js')
const assert = require('assert')
const co = require('co')

describe('terminal-validator', () => {
  before(() => co(function * () {

  }))

  after(() => co(function * () {

  }))

  it('Terminal validator', () => co(function * () {
    assert.ok(new TerminalValidator())
  }))
})

/* global describe, before, after, it */
