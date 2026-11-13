package com.roadtripgames.shotgun

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.experimental.xor

class HotspotGameServer(
    private val assetLoader: (String) -> InputStream?
) {
    @Volatile
    var port: Int = 8080
        private set

    @Volatile
    var hotspotExternalEnabled: Boolean = false

    @Volatile
    private var running = false

    private var serverSocket: ServerSocket? = null
    private val workerPool = Executors.newCachedThreadPool()
    private var keepAliveScheduler: ScheduledExecutorService? = null

    private val stateLock = Any()
    private var hostSession: WsSession? = null
    private var latestPublicState: JSONObject? = null
    private var latestPrivateStates: JSONObject = JSONObject()

    private data class ClientRecord(
        val playerId: String,
        var name: String,
        var emoji: String,
        var color: String,
        var connected: Boolean,
        var session: WsSession?
    )

    private val clients = ConcurrentHashMap<String, ClientRecord>()
    private val activeSessions = ConcurrentHashMap.newKeySet<WsSession>()

    fun start(preferredPort: Int = 8080): Int {
        if (running && serverSocket != null && !serverSocket!!.isClosed) {
            return port
        }

        var boundSocket: ServerSocket? = null
        val candidates = if (preferredPort == 0) listOf(0) else (preferredPort..(preferredPort + 15)).toList()

        for (candidate in candidates) {
            try {
                val ss = ServerSocket()
                ss.reuseAddress = true
                ss.bind(InetSocketAddress("0.0.0.0", candidate))
                boundSocket = ss
                port = ss.localPort
                break
            } catch (_: Exception) {
                // Try next port
            }
        }

        val ss = boundSocket ?: throw IllegalStateException("Unable to bind HotspotGameServer")
        serverSocket = ss
        running = true

        workerPool.execute {
            while (running && !ss.isClosed) {
                try {
                    val client = ss.accept()
                    client.tcpNoDelay = true
                    workerPool.execute { handleSocket(client) }
                } catch (_: Exception) {
                    if (!running) break
                }
            }
        }

        keepAliveScheduler = Executors.newSingleThreadScheduledExecutor().apply {
            scheduleAtFixedRate({
                for (session in activeSessions) {
                    if (!session.sendPing()) {
                        session.closeQuietly()
                    }
                }
            }, 20, 20, TimeUnit.SECONDS)
        }

        return port
    }

    fun setExternalHotspotOpen(enabled: Boolean) {
        hotspotExternalEnabled = enabled
        if (!enabled) {
            // Disconnect external non-loopback passenger sockets cleanly
            for (session in activeSessions) {
                if (!session.isLoopback) {
                    session.closeQuietly()
                }
            }
            synchronized(stateLock) {
                clients.clear()
                latestPublicState = null
                latestPrivateStates = JSONObject()
            }
        }
    }

    fun buildServerInfoJson(): String {
        val addrs = NetworkUtils.detectLocalAddresses()
        val ipsArr = JSONArray()
        for (a in addrs) {
            ipsArr.put(
                JSONObject()
                    .put("label", a.label)
                    .put("ip", a.ip)
            )
        }
        val primaryIp = addrs.firstOrNull()?.ip ?: "192.168.43.1"
        return JSONObject()
            .put("mode", "hotspot")
            .put("port", port)
            .put("ips", ipsArr)
            .put("primaryUrl", "http://$primaryIp:$port")
            .put("roomCode", "RIDE")
            .toString()
    }

    fun stop() {
        running = false
        keepAliveScheduler?.shutdownNow()
        keepAliveScheduler = null
        for (s in activeSessions) {
            s.closeQuietly()
        }
        activeSessions.clear()
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
    }

    private fun handleSocket(socket: Socket) {
        val isLoopback = socket.inetAddress?.isLoopbackAddress == true
        if (!isLoopback && !hotspotExternalEnabled) {
            try {
                socket.close()
            } catch (_: Exception) {
            }
            return
        }

        try {
            socket.soTimeout = 15_000
            val input = BufferedInputStream(socket.getInputStream())
            val output = socket.getOutputStream()

            val requestLine = readHttpLine(input) ?: run {
                socket.close()
                return
            }
            val parts = requestLine.split(" ")
            if (parts.size < 2) {
                socket.close()
                return
            }
            val rawPath = parts[1]
            val headers = mutableMapOf<String, String>()
            while (true) {
                val line = readHttpLine(input) ?: break
                if (line.isEmpty()) break
                val colon = line.indexOf(':')
                if (colon > 0) {
                    val k = line.substring(0, colon).trim().lowercase()
                    val v = line.substring(colon + 1).trim()
                    headers[k] = v
                }
            }

            val upgrade = headers["upgrade"]?.lowercase()
            if (upgrade == "websocket") {
                val wsKey = headers["sec-websocket-key"]
                if (wsKey.isNullOrBlank()) {
                    socket.close()
                    return
                }
                socket.soTimeout = 0 // Long-lived WebSocket connection
                handleWebSocket(socket, input, output, wsKey, isLoopback)
            } else {
                handleHttpRequest(rawPath, output)
                try {
                    socket.close()
                } catch (_: Exception) {
                }
            }
        } catch (_: Exception) {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun handleHttpRequest(rawPath: String, output: OutputStream) {
        val cleanRoute = rawPath.substringBefore('?').substringBefore('#')
        if (cleanRoute == "/api/server-info") {
            val bytes = buildServerInfoJson().toByteArray(Charsets.UTF_8)
            writeHttpResponse(output, "200 OK", "application/json; charset=utf-8", bytes)
            return
        }

        var assetPath = if (cleanRoute == "/" || cleanRoute.isEmpty()) "index.html" else cleanRoute.trimStart('/')
        if (assetPath.contains("..")) {
            writeHttpResponse(output, "403 Forbidden", "text/plain; charset=utf-8", "Forbidden".toByteArray())
            return
        }
        assetPath = assetPath.trimStart('/')

        val stream = try {
            assetLoader(assetPath)
        } catch (_: Exception) {
            null
        }

        if (stream == null) {
            writeHttpResponse(output, "404 Not Found", "text/plain; charset=utf-8", "Not found".toByteArray())
            return
        }

        val bytes = stream.use { it.readBytes() }
        val mime = guessMimeType(assetPath)
        writeHttpResponse(output, "200 OK", mime, bytes)
    }

    private fun writeHttpResponse(output: OutputStream, status: String, contentType: String, body: ByteArray) {
        val header = buildString {
            append("HTTP/1.1 ").append(status).append("\r\n")
            append("Content-Type: ").append(contentType).append("\r\n")
            append("Content-Length: ").append(body.size).append("\r\n")
            append("Cache-Control: no-cache\r\n")
            append("Connection: close\r\n\r\n")
        }.toByteArray(Charsets.US_ASCII)
        output.write(header)
        output.write(body)
        output.flush()
    }

    private fun handleWebSocket(
        socket: Socket,
        input: InputStream,
        output: OutputStream,
        secKey: String,
        isLoopback: Boolean
    ) {
        val acceptHash = MessageDigest.getInstance("SHA-1")
            .digest((secKey.trim() + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray(Charsets.US_ASCII))
        val acceptKey = encodeBase64(acceptHash)

        val handshake = (
            "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: $acceptKey\r\n\r\n"
            ).toByteArray(Charsets.US_ASCII)
        output.write(handshake)
        output.flush()

        val session = WsSession(socket, output, isLoopback)
        activeSessions.add(session)

        val fragmentBuffer = ByteArrayOutputStream()
        try {
            while (running && !socket.isClosed) {
                val b0 = input.read()
                if (b0 == -1) break
                val b1 = input.read()
                if (b1 == -1) break

                val fin = (b0 and 0x80) != 0
                val opcode = b0 and 0x0F
                val masked = (b1 and 0x80) != 0
                var payloadLen = (b1 and 0x7F).toLong()

                if (payloadLen == 126L) {
                    val ext = readFully(input, 2)
                    payloadLen = (((ext[0].toInt() and 0xFF) shl 8) or (ext[1].toInt() and 0xFF)).toLong()
                } else if (payloadLen == 127L) {
                    val ext = readFully(input, 8)
                    payloadLen = 0L
                    for (i in 0 until 8) {
                        payloadLen = (payloadLen shl 8) or (ext[i].toLong() and 0xFFL)
                    }
                }

                if (payloadLen < 0L || payloadLen > 2_000_000L) break

                val maskKey = if (masked) readFully(input, 4) else null
                val payload = readFully(input, payloadLen.toInt())
                if (maskKey != null) {
                    for (i in payload.indices) {
                        payload[i] = payload[i] xor maskKey[i and 3]
                    }
                }

                when (opcode) {
                    0x08 -> { // Close
                        session.sendFrame(0x08, ByteArray(0))
                        break
                    }
                    0x09 -> { // Ping -> Pong
                        session.sendFrame(0x0A, payload)
                    }
                    0x0A -> {
                        // Pong
                    }
                    0x01, 0x00 -> {
                        fragmentBuffer.write(payload)
                        if (fin) {
                            val text = fragmentBuffer.toByteArray().toString(Charsets.UTF_8)
                            fragmentBuffer.reset()
                            onWsMessage(session, text)
                        }
                    }
                }
            }
        } catch (_: Exception) {
            // Disconnected
        } finally {
            activeSessions.remove(session)
            onWsDisconnected(session)
            session.closeQuietly()
        }
    }

    private fun onWsMessage(session: WsSession, rawText: String) {
        val msg = try {
            JSONObject(rawText)
        } catch (_: Exception) {
            return
        }
        val type = msg.optString("type", "")
        if (type.isEmpty()) return

        synchronized(stateLock) {
            when (type) {
                "register_host" -> {
                    session.isHost = true
                    session.playerId = msg.optString("hostId", "host")
                    hostSession = session
                    sendPresenceToHostLocked()
                }

                "join_client" -> {
                    val pid = msg.optString("playerId", "")
                    if (pid.isEmpty()) return
                    val name = msg.optString("name", "Passenger").take(16)
                    val emoji = msg.optString("emoji", "🕶️")
                    val color = msg.optString("color", "#4cc9f0")

                    session.isHost = false
                    session.playerId = pid

                    clients[pid] = ClientRecord(
                        playerId = pid,
                        name = name,
                        emoji = emoji,
                        color = color,
                        connected = true,
                        session = session
                    )

                    // Immediately push cached game state if round is already underway!
                    val pub = latestPublicState
                    if (pub != null) {
                        val update = JSONObject()
                            .put("type", "state_update")
                            .put("publicState", pub)
                            .put("myState", latestPrivateStates.opt(pid) ?: JSONObject.NULL)
                        session.sendText(update.toString())
                    }

                    sendPresenceToHostLocked()
                }

                "host_sync" -> {
                    if (session == hostSession) {
                        latestPublicState = msg.optJSONObject("publicState")
                        latestPrivateStates = msg.optJSONObject("privateStates") ?: JSONObject()
                        val pub = latestPublicState ?: JSONObject.NULL
                        for ((pid, rec) in clients) {
                            val s = rec.session
                            if (rec.connected && s != null) {
                                val update = JSONObject()
                                    .put("type", "state_update")
                                    .put("publicState", pub)
                                    .put("myState", latestPrivateStates.opt(pid) ?: JSONObject.NULL)
                                s.sendText(update.toString())
                            }
                        }
                    }
                }

                "host_event" -> {
                    if (session == hostSession) {
                        val ev = msg.optJSONObject("event") ?: return
                        val packet = JSONObject()
                            .put("type", "host_event")
                            .put("event", ev)
                            .toString()
                        for (rec in clients.values) {
                            if (rec.connected) {
                                rec.session?.sendText(packet)
                            }
                        }
                    }
                }

                "client_action" -> {
                    val pid = msg.optString("playerId", "")
                    val action = msg.optJSONObject("action")
                    if (pid.isNotEmpty() && action != null) {
                        val forward = JSONObject()
                            .put("type", "client_action")
                            .put("playerId", pid)
                            .put("action", action)
                        hostSession?.sendText(forward.toString())
                    }
                }
            }
        }
    }

    private fun onWsDisconnected(session: WsSession) {
        synchronized(stateLock) {
            if (session == hostSession) {
                hostSession = null
            } else {
                val pid = session.playerId
                if (!pid.isNullOrEmpty()) {
                    val rec = clients[pid]
                    if (rec != null && rec.session == session) {
                        rec.connected = false
                        rec.session = null
                        sendPresenceToHostLocked()
                    }
                }
            }
        }
    }

    private fun sendPresenceToHostLocked() {
        val host = hostSession ?: return
        val arr = JSONArray()
        for (rec in clients.values) {
            arr.put(
                JSONObject()
                    .put("playerId", rec.playerId)
                    .put("name", rec.name)
                    .put("emoji", rec.emoji)
                    .put("color", rec.color)
                    .put("connected", rec.connected)
            )
        }
        val packet = JSONObject()
            .put("type", "presence")
            .put("clients", arr)
        host.sendText(packet.toString())
    }

    private class WsSession(
        private val socket: Socket,
        private val output: OutputStream,
        val isLoopback: Boolean
    ) {
        private val writeLock = Any()
        var isHost: Boolean = false
        var playerId: String? = null

        fun sendText(text: String): Boolean {
            return sendFrame(0x01, text.toByteArray(Charsets.UTF_8))
        }

        fun sendPing(): Boolean {
            return sendFrame(0x09, ByteArray(0))
        }

        fun sendFrame(opcode: Int, payload: ByteArray): Boolean {
            synchronized(writeLock) {
                return try {
                    val size = payload.size
                    output.write(0x80 or (opcode and 0x0F))
                    when {
                        size <= 125 -> output.write(size)
                        size <= 65535 -> {
                            output.write(126)
                            output.write((size shr 8) and 0xFF)
                            output.write(size and 0xFF)
                        }
                        else -> {
                            output.write(127)
                            val longSize = size.toLong()
                            for (shift in 56 downTo 0 step 8) {
                                output.write(((longSize ushr shift) and 0xFFL).toInt())
                            }
                        }
                    }
                    output.write(payload)
                    output.flush()
                    true
                } catch (_: Exception) {
                    false
                }
            }
        }

        fun closeQuietly() {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }

    companion object {
        private const val B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

        fun encodeBase64(data: ByteArray): String {
            val sb = StringBuilder(((data.size + 2) / 3) * 4)
            var i = 0
            while (i < data.size) {
                val b0 = data[i].toInt() and 0xFF
                val b1 = if (i + 1 < data.size) data[i + 1].toInt() and 0xFF else 0
                val b2 = if (i + 2 < data.size) data[i + 2].toInt() and 0xFF else 0
                val triple = (b0 shl 16) or (b1 shl 8) or b2

                sb.append(B64_ALPHABET[(triple ushr 18) and 0x3F])
                sb.append(B64_ALPHABET[(triple ushr 12) and 0x3F])
                sb.append(if (i + 1 < data.size) B64_ALPHABET[(triple ushr 6) and 0x3F] else '=')
                sb.append(if (i + 2 < data.size) B64_ALPHABET[triple and 0x3F] else '=')
                i += 3
            }
            return sb.toString()
        }

        private fun readHttpLine(input: InputStream): String? {
            val buf = ByteArrayOutputStream(128)
            while (buf.size() < 8192) {
                val b = input.read()
                if (b == -1) {
                    return if (buf.size() == 0) null else buf.toString("US-ASCII").trimEnd('\r')
                }
                if (b == '\n'.code) {
                    return buf.toString("US-ASCII").trimEnd('\r')
                }
                buf.write(b)
            }
            return buf.toString("US-ASCII").trimEnd('\r')
        }

        private fun readFully(input: InputStream, length: Int): ByteArray {
            val out = ByteArray(length)
            var offset = 0
            while (offset < length) {
                val read = input.read(out, offset, length - offset)
                if (read == -1) throw EOFException("Unexpected EOF")
                offset += read
            }
            return out
        }

        private fun guessMimeType(path: String): String {
            val lower = path.lowercase()
            return when {
                lower.endsWith(".html") -> "text/html; charset=utf-8"
                lower.endsWith(".css") -> "text/css; charset=utf-8"
                lower.endsWith(".js") -> "application/javascript; charset=utf-8"
                lower.endsWith(".json") -> "application/manifest+json; charset=utf-8"
                lower.endsWith(".svg") -> "image/svg+xml"
                lower.endsWith(".png") -> "image/png"
                lower.endsWith(".ico") -> "image/x-icon"
                else -> "application/octet-stream"
            }
        }
    }
}
