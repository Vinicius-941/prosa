package app.prosa.mobile;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "ProsaSessionVault")
public class ProsaSessionVaultPlugin extends Plugin {
    private static final String KEY_ALIAS = "prosa.session.v1";
    private static final String PREFERENCES = "prosa_secure_session";
    private static final String TOKEN_KEY = "token";
    private static final int IV_LENGTH = 12;
    private static final int TAG_LENGTH_BITS = 128;

    @PluginMethod
    public void getToken(PluginCall call) {
        try {
            String encrypted = getContext().getSharedPreferences(PREFERENCES, 0).getString(TOKEN_KEY, null);
            JSObject result = new JSObject();
            result.put("value", encrypted == null ? JSObject.NULL : decrypt(encrypted));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Não foi possível ler a sessão protegida.", error);
        }
    }

    @PluginMethod
    public void setToken(PluginCall call) {
        String token = call.getString("value");
        if (token == null || !token.matches("[A-Za-z0-9_-]{32,64}")) {
            call.reject("Token de sessão inválido.");
            return;
        }
        try {
            boolean saved = getContext().getSharedPreferences(PREFERENCES, 0).edit()
                .putString(TOKEN_KEY, encrypt(token)).commit();
            if (!saved) throw new IllegalStateException("Persistent storage failed");
            call.resolve();
        } catch (Exception error) {
            call.reject("Não foi possível proteger a sessão neste dispositivo.", error);
        }
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        boolean removed = getContext().getSharedPreferences(PREFERENCES, 0).edit().remove(TOKEN_KEY).commit();
        if (!removed) {
            call.reject("Não foi possível remover a sessão protegida.");
            return;
        }
        call.resolve();
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getSecretKey());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] combined = new byte[cipher.getIV().length + encrypted.length];
        System.arraycopy(cipher.getIV(), 0, combined, 0, cipher.getIV().length);
        System.arraycopy(encrypted, 0, combined, cipher.getIV().length, encrypted.length);
        return Base64.encodeToString(combined, Base64.NO_WRAP);
    }

    private String decrypt(String value) throws Exception {
        byte[] combined = Base64.decode(value, Base64.NO_WRAP);
        if (combined.length <= IV_LENGTH) throw new IllegalArgumentException("Invalid encrypted session");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getSecretKey(), new GCMParameterSpec(TAG_LENGTH_BITS, combined, 0, IV_LENGTH));
        return new String(cipher.doFinal(combined, IV_LENGTH, combined.length - IV_LENGTH), StandardCharsets.UTF_8);
    }

    private SecretKey getSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }
}
