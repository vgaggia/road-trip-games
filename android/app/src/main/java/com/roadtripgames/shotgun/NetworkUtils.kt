package com.roadtripgames.shotgun

import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections

data class DetectedAddress(
    val label: String,
    val ip: String,
    val priority: Int
)

object NetworkUtils {

    fun detectLocalAddresses(): List<DetectedAddress> {
        val results = mutableListOf<DetectedAddress>()
        val interfaces = try {
            val raw = NetworkInterface.getNetworkInterfaces()
            if (raw != null) Collections.list(raw) else emptyList()
        } catch (_: Exception) {
            emptyList()
        }

        for (nif in interfaces) {
            val isUp = try {
                nif.isUp && !nif.isLoopback
            } catch (_: Exception) {
                false
            }
            if (!isUp) continue

            val name = (nif.name ?: "").lowercase()
            // Skip cellular, VPN, loopback, dummy interfaces
            if (name.startsWith("rmnet") ||
                name.startsWith("ccmni") ||
                name.startsWith("pdp") ||
                name.startsWith("clat") ||
                name.startsWith("tun") ||
                name.startsWith("ppp") ||
                name.startsWith("wg") ||
                name.startsWith("dummy") ||
                name == "lo"
            ) {
                continue
            }

            val addrs = try {
                Collections.list(nif.inetAddresses)
            } catch (_: Exception) {
                emptyList()
            }

            for (addr in addrs) {
                if (addr !is Inet4Address || addr.isLoopbackAddress || addr.isLinkLocalAddress) {
                    continue
                }
                val ip = addr.hostAddress ?: continue
                if (isCgnat(ip)) continue

                val (label, priority) = classifyInterface(name, ip)
                results.add(DetectedAddress(label, ip, priority))
            }
        }

        results.sortBy { it.priority }
        val deduped = results.distinctBy { it.ip }

        return if (deduped.isNotEmpty()) {
            deduped
        } else {
            listOf(DetectedAddress("Enable Hotspot", "192.168.43.1", 99))
        }
    }

    private fun isCgnat(ip: String): Boolean {
        val parts = ip.split(".")
        if (parts.size != 4) return false
        val first = parts[0].toIntOrNull() ?: return false
        val second = parts[1].toIntOrNull() ?: return false
        return first == 100 && second in 64..127
    }

    private fun classifyInterface(name: String, ip: String): Pair<String, Int> {
        return when {
            name.startsWith("ap") ||
                name.startsWith("swlan") ||
                name.startsWith("softap") ||
                name == "wlan1" ||
                name == "wlan2" ||
                name.startsWith("tether") ||
                name.startsWith("rndis") ||
                ip == "192.168.43.1" -> "Hotspot" to 1

            name.startsWith("wlan") || name.startsWith("en") || name.startsWith("eth") ->
                "Wi-Fi" to 2

            ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172.") ->
                "Local LAN" to 3

            else -> "Network" to 4
        }
    }
}
