package com.roadtripgames.shotgun

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.Socket
import java.net.URL
import kotlin.experimental.xor

class HotspotGameServerTest {

    @Test
    fun testHttpServingAndFourPlayerWebSocketRelay() {
        val fakeAssets = mapOf(
            "index.html" to "<!DOCTYPE html><html><body>SHOTGUN!</body></html>",
            "app.js" to "console.log('ready');"
        )
        val server = HotspotGameServer { path ->
            fakeAssets[path]?.let { ByteArrayInputStream(it.toByteArray(Charsets.UTF_8)) }
        }

        val port = server.start(0)
        server.setExternalHotspotOpen(true)

        try {
            // 1. Verify HTTP root & /api/server-info
            val htmlConn = URL("http://127.0.0.1:$port/").openConnection() as HttpURLConnection
            assertEquals(200, htmlConn.responseCode)
            val htmlText = htmlConn.inputStream.bufferedReader().readText()
            assertTrue(htmlText.contains("SHOTGUN!"))

            val infoConn = URL("http://127.0.0.1:$port/api/server-info").openConnection() as HttpURLConnection
            assertEquals(200, infoConn.responseCode)
            val infoJson = JSONObject(infoConn.inputStream.bufferedReader().readText())
            assertEquals("hotspot", infoJson.getString("mode"))
            assertEquals(port, infoJson.getInt("port"))

            // 2. Connect Host + 2 Passengers via RFC 6455 WebSocket
            val hostWs = SimpleWsClient("127.0.0.1", port)
            val p2Ws = SimpleWsClient("127.0.0.1", port)
            val p3Ws = SimpleWsClient("127.0.0.1", port)

            hostWs.sendMaskedText("""{"type":"register_host","hostId":"h1"}""")
            val initPresence = JSONObject(hostWs.readFrameText())
            assertEquals("presence", initPresence.getString("type"))

            p2Ws.sendMaskedText("""{"type":"join_client","playerId":"p2","name":"Alex","emoji":"🦊","color":"#ff7b39"}""")
            val pres1 = JSONObject(hostWs.readFrameText())
            assertEquals(1, pres1.getJSONArray("clients").length())

            p3Ws.sendMaskedText("""{"type":"join_client","playerId":"p3","name":"Sam","emoji":"🕶️","color":"#4cc9f0"}""")
            val pres2 = JSONObject(hostWs.readFrameText())
            assertEquals(2, pres2.getJSONArray("clients").length())

            // 3. Host broadcasts >126 byte state with private per-player secrets!
            val bigPadding = "x".repeat(300)
            val syncPayload = JSONObject()
                .put("type", "host_sync")
                .put("publicState", JSONObject().put("hostScreen", "game").put("pad", bigPadding))
                .put(
                    "privateStates",
                    JSONObject()
                        .put("p2", JSONObject().put("isImpostor", true))
                        .put("p3", JSONObject().put("isImpostor", false).put("secretWord", "SLUSHIE"))
                )
            hostWs.sendMaskedText(syncPayload.toString())

            val p2State = JSONObject(p2Ws.readFrameText())
            assertEquals("state_update", p2State.getString("type"))
            assertTrue(p2State.getJSONObject("myState").getBoolean("isImpostor"))

            val p3State = JSONObject(p3Ws.readFrameText())
            assertEquals("SLUSHIE", p3State.getJSONObject("myState").getString("secretWord"))

            // 4. Passenger sends action -> Host receives it
            p2Ws.sendMaskedText("""{"type":"client_action","playerId":"p2","action":{"kind":"bingo_claim","tileIdx":4}}""")
            val forwarded = JSONObject(hostWs.readFrameText())
            assertEquals("client_action", forwarded.getString("type"))
            assertEquals("p2", forwarded.getString("playerId"))
            assertEquals(4, forwarded.getJSONObject("action").getInt("tileIdx"))

            // 5. Passenger reconnects -> Immediately gets cached state!
            p3Ws.close()
            val p3Reconn = SimpleWsClient("127.0.0.1", port)
            p3Reconn.sendMaskedText("""{"type":"join_client","playerId":"p3","name":"Sam","emoji":"🕶️","color":"#4cc9f0"}""")
            val cachedMsg = JSONObject(p3Reconn.readFrameText())
            assertNotNull(cachedMsg.optJSONObject("publicState"))
            assertEquals("SLUSHIE", cachedMsg.getJSONObject("myState").getString("secretWord"))

            hostWs.close()
            p2Ws.close()
            p3Reconn.close()
        } finally {
            server.stop()
        }
    }

    private class SimpleWsClient(host: String, port: Int) {
        private val socket = Socket(host, port).apply { soTimeout = 5000 }
        private val input = socket.getInputStream()
        private val output = socket.getOutputStream()

        init {
            val req = (
                "GET /ws HTTP/1.1\r\n" +
                    "Host: $host:$port\r\n" +
                    "Upgrade: websocket\r\n" +
                    "Connection: Upgrade\r\n" +
                    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
                    "Sec-WebSocket-Version: 13\r\n\r\n"
                ).toByteArray(Charsets.US_ASCII)
            output.write(req)
            output.flush()

            // Read until \r\n\r\n
            val sb = StringBuilder()
            while (!sb.endsWith("\r\n\r\n")) {
                val c = input.read()
                if (c == -1) throw IllegalStateException("Handshake failed")
                sb.append(c.toChar())
            }
            assertTrue(sb.toString().contains("101 Switching Protocols"))
        }

        fun sendMaskedText(text: String) {
            val bytes = text.toByteArray(Charsets.UTF_8)
            val mask = byteArrayOf(0x12, 0x34, 0x56, 0x78)
            output.write(0x81)
            if (bytes.size <= 125) {
                output.write(0x80 or bytes.size)
            } else {
                output.write(0x80 or 126)
                output.write((bytes.size shr 8) and 0xFF)
                output.write(bytes.size and 0xFF)
            }
            output.write(mask)
            val masked = ByteArray(bytes.size) { i -> bytes[i] xor mask[i and 3] }
            output.write(masked)
            output.flush()
        }

        fun readFrameText(): String {
            val b0 = input.read()
            val b1 = input.read()
            var len = b1 and 0x7F
            if (len == 126) {
                len = ((input.read() and 0xFF) shl 8) or (input.read() and 0xFF)
            }
            val buf = readExact(input, len)
            assertEquals(0x81, b0)
            return buf.toString(Charsets.UTF_8)
        }

        private fun readExact(ins: InputStream, n: Int): ByteArray {
            val b = ByteArray(n)
            var off = 0
            while (off < n) {
                val r = ins.read(b, off, n - off)
                if (r == -1) throw IllegalStateException("EOF")
                off += r
            }
            return b
        }

        fun close() {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
    }
}
