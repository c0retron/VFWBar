package org.vfwcanteen.pos;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;

// Sends raw bytes to a WiFi ESC/POS receipt printer over a plain TCP socket
// (port 9100 is the near-universal default for these -- "JetDirect"/raw
// printing, the same protocol used by network laser printers for decades).
// No WebView/JS API can open a raw socket, so this is a small custom native
// plugin rather than depending on a third-party one of uncertain quality --
// the protocol itself is simple enough that writing it is lower-risk than
// vetting someone else's plugin. All ESC/POS command-byte formatting happens
// on the JS side (src/printer.js); this plugin only moves bytes.
@CapacitorPlugin(name = "EscPosPrinter")
public class EscPosPrinterPlugin extends Plugin {
    @PluginMethod
    public void printRaw(PluginCall call) {
        String ip = call.getString("ip");
        int port = call.getInt("port", 9100);
        String dataBase64 = call.getString("dataBase64");
        if (ip == null || ip.isEmpty() || dataBase64 == null) {
            call.reject("Missing ip or dataBase64");
            return;
        }
        new Thread(() -> {
            try {
                Socket socket = new Socket();
                try {
                    socket.connect(new InetSocketAddress(ip, port), 5000);
                    socket.setSoTimeout(5000);
                    OutputStream out = socket.getOutputStream();
                    byte[] bytes = Base64.decode(dataBase64, Base64.NO_WRAP);
                    out.write(bytes);
                    out.flush();
                } finally {
                    socket.close();
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Print failed: " + e.getMessage(), e);
            }
        }).start();
    }
}
