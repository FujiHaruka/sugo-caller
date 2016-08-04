/**
 * Caller to access remote actor
 * @class SugoCaller
 * @param {string|Object} URL - Hub url to connect
 */
'use strict'

const sgSocketClient = require('sg-socket-client')
const ActorValidator = require('./validating/caller_validator')
const { EventEmitter } = require('events')
const { RemoteEvents } = require('sg-socket-constants')
const { JOIN, LEAVE, PERFORM, PIPE } = RemoteEvents

const ActorAccess = require('./accessing/actor_access')
const co = require('co')
const assert = require('assert')
const sgQueue = require('sg-queue')
const formatUrl = require('url').format
const { HubUrls } = require('sugo-constants')
const defaults = require('defaults')
let _connectQueue = sgQueue()

/** @lends SugoCaller */
class SugoCaller extends EventEmitter {
  constructor (url, options = {}) {
    if (typeof url === 'object') {
      url = formatUrl(defaults(url, {
        protocol: 'http',
        port: 80,
        hostname: 'localhost',
        pathname: HubUrls.CALLER_URL
      }))
    }

    assert.ok(url, 'URL is required.')
    super()
    const s = this
    s.url = url
    s.validator = new ActorValidator()
    s.sockets = {}
    s.accesses = {}

    s.onError = (err) => s.emit(err) || Promise.reject(err)
  }

  /**
   * Connect to actor
   * @param {string} key - Key of actor
   * @returns {Promise.<Object>} - Actor accessor
   */
  connect (key) {
    const s = this
    let doConnect = () => co(function * () {
      if (s.accesses[ key ]) {
        throw new Error(`Already connected to: ${key}`)
      }

      let access = yield s.actorAccess(key)
      s.accesses[ key ] = access

      let { bundle } = access
      Object.assign(bundle, {
        disconnect () {
          return co(function * () {
            let { pipeListeners } = access
            for (let module of Object.keys(pipeListeners)) {
              delete pipeListeners[ module ]
            }
            let socket = s.sockets[ key ]
            yield socket.call(LEAVE, { key })
            delete s.accesses[ key ]
            socket.close()
            yield socket.waitToDisconnect()
            delete s.sockets[ key ]
          })
        }
      })
      return bundle
    }).catch((err) => {
      let socket = s.sockets[ key ]
      if (socket) {
        socket.call(LEAVE, { key })
        socket.close()
      }
      delete s.accesses[ key ]
      delete s.sockets[ key ]
      return Promise.reject(err)
    })

    let { connectQueue } = SugoCaller
    return connectQueue.push(doConnect)
  }

  /**
   * Disconnect from cloud server
   * @returns {Promise}
   */
  disconnect (key) {
    const s = this
    return co(function * () {
      if (key) {
        let access = s.accesses[ key ]
        if (!access) {
          throw new Error(`Not connected to: ${key}`)
        }
        yield access.bundle.disconnect()
        delete s.accesses[ key ]
      } else {
        for (let key of Object.keys(s.accesses)) {
          let access = s.accesses[ key ]
          yield access.bundle.disconnect()
        }
        s.accesses = {}
      }
    })
  }

  actorAccess (key) {
    const s = this
    return co(function * () {
      let socket = sgSocketClient(s.url)
      yield socket.waitToConnect()
      let { payload } = yield socket.call(JOIN, { key })
      let { specs } = payload

      let vError = s.validator.validateInterfaceSpecs(specs)
      if (vError) {
        throw vError
      }

      socket.on(PIPE, (piped) => {
        let { pipeListeners } = access
        let listeners = (pipeListeners[ piped.module ] || {})[ piped.event ] || []
        for (let listener of listeners) {
          listener(piped.data)
        }
      })

      s.sockets[ key ] = socket

      let access = new ActorAccess({
        specs,
        validator: s.validator,
        // Connection methods for access edge
        connector: {
          invoke: co.wrap(function * invokeMethod (module, method, params) {
            s.assertConnection(key)
            let { payload } = yield socket.call(PERFORM, { key, method, params, module })
            return payload
          }),
          fire: co.wrap(function * fireEvent (module, event, data) {
            s.assertConnection(key)
            socket.emit(PIPE, { key, event, data, module })
          }),
          listen: co.wrap(function * registerListener (module, event, listener) {
            s.assertConnection(key)
            let { pipeListeners } = access
            pipeListeners[ module ] = pipeListeners[ module ] || {}
            pipeListeners[ module ][ event ] = (pipeListeners[ module ][ event ] || []).concat(listener)
          }),
          delisten: co.wrap(function * deregisterListener (module, event, listener) {
            s.assertConnection(key)
            let { pipeListeners } = access
            if (!pipeListeners[ module ][ event ]) {
              return
            }
            pipeListeners[ module ][ event ] = pipeListeners[ module ][ event ].filter((filterling) => filterling !== listener)
          })
        }
      })
      Object.assign(access, { pipeListeners: {} })
      return access
    })
  }

  assertConnection (key) {
    const s = this
    if (!s.sockets[ key ]) {
      throw new Error('Not connected!!')
    }
  }

  static get connectQueue () {
    return _connectQueue
  }
}

module.exports = SugoCaller
