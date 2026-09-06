package com.kuocai.cdn.component;

import com.kuocai.cdn.exception.BusinessException;
import com.kuocai.cdn.util.Assert;
import com.kuocai.cdn.util.KuocaiBaseUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Local disk storage client, replacing the original MinIO-based OssClient.
 * Uploaded files are stored under the configured upload directory and served
 * from the same-origin /uploads/ path.
 */
@Slf4j
@Component
public class LocalStorageClient {

    @Value("${app.upload-dir:./uploads}")
    private String uploadDir;

    @Value("${app.public-upload-path:/uploads}")
    private String publicUploadPath;

    public String upload(MultipartFile file) throws Exception {
        if (Assert.isEmpty(file)) {
            return null;
        }
        BigDecimal fileSize = KuocaiBaseUtil.flowUnitConversion(file.getSize(), "MB");
        if (fileSize.longValue() > 10) {
            throw new BusinessException("文件过大");
        }
        String filename = file.getOriginalFilename();
        if (Assert.isEmpty(filename)) {
            return null;
        }
        String type = filename.substring(filename.lastIndexOf("."));
        String fileName = UUID.randomUUID().toString().replace("-", "") + type;
        Path dir = Paths.get(uploadDir);
        Files.createDirectories(dir);
        Path target = dir.resolve(fileName).normalize();
        if (!target.startsWith(dir)) {
            throw new BusinessException("非法文件路径");
        }
        try (InputStream inputStream = file.getInputStream()) {
            Files.copy(inputStream, target);
        }
        return buildPublicUrl(fileName);
    }

    public String normalizePublicUrl(String url) {
        if (Assert.isEmpty(url)) {
            return url;
        }
        String trimmedUrl = url.trim().replace("\\", "/");
        String prefix = publicUploadPath + "/";
        int index = trimmedUrl.indexOf(prefix);
        if (index >= 0) {
            return trimmedUrl.substring(index);
        }
        return trimmedUrl;
    }

    public String extractObjectName(String urlOrPath) {
        if (Assert.isEmpty(urlOrPath)) {
            return null;
        }
        String value = urlOrPath.trim().replace("\\", "/");
        String prefix = publicUploadPath + "/";
        int index = value.indexOf(prefix);
        if (index >= 0) {
            return value.substring(index + prefix.length());
        }
        int lastSlash = value.lastIndexOf('/');
        return lastSlash >= 0 ? value.substring(lastSlash + 1) : value;
    }

    public boolean isPublicImageObjectName(String objectName) {
        if (!isSafeObjectName(objectName)) {
            return false;
        }
        int dotIndex = objectName.lastIndexOf('.');
        if (dotIndex <= 0 || dotIndex == objectName.length() - 1) {
            return false;
        }
        String extension = objectName.substring(dotIndex + 1).toLowerCase(Locale.ROOT);
        return "png".equals(extension)
                || "jpg".equals(extension)
                || "jpeg".equals(extension)
                || "gif".equals(extension)
                || "webp".equals(extension)
                || "bmp".equals(extension)
                || "svg".equals(extension)
                || "ico".equals(extension);
    }

    public long getObjectSize(String objectName) throws IOException {
        Path path = resolveObjectPath(objectName);
        return Files.size(path);
    }

    public InputStream getObject(String objectName) throws IOException {
        return new FileInputStream(resolveObjectPath(objectName).toFile());
    }

    public List<String> getFilesName() {
        List<String> names = new ArrayList<>();
        File dir = new File(uploadDir);
        File[] files = dir.listFiles();
        if (files != null) {
            for (File file : files) {
                if (file.isFile()) {
                    names.add(file.getName());
                }
            }
        }
        return names;
    }

    public String getUUIDFileName(String name) {
        String extension = "";
        if (Assert.notEmpty(name) && name.contains(".")) {
            extension = name.substring(name.lastIndexOf("."));
        }
        return UUID.randomUUID().toString().replace("-", "") + extension;
    }

    public String getFileMd5(InputStream stream) {
        try (InputStream in = stream) {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("MD5");
            byte[] buffer = new byte[8192];
            int len;
            while ((len = in.read(buffer)) != -1) {
                md.update(buffer, 0, len);
            }
            byte[] digest = md.digest();
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            log.error("计算文件MD5失败", e);
            return null;
        }
    }

    public String getFileMd5(MultipartFile multipartFile) throws IOException {
        try (InputStream in = multipartFile.getInputStream()) {
            return getFileMd5(in);
        }
    }

    private Path resolveObjectPath(String objectName) throws IOException {
        if (!isSafeObjectName(objectName)) {
            throw new IOException("Illegal object name: " + objectName);
        }
        Path dir = Paths.get(uploadDir).toAbsolutePath();
        Path target = dir.resolve(objectName).normalize();
        if (!target.startsWith(dir)) {
            throw new IOException("Illegal object path: " + objectName);
        }
        if (!Files.exists(target)) {
            throw new IOException("Object not found: " + objectName);
        }
        return target;
    }

    private boolean isSafeObjectName(String objectName) {
        if (Assert.isEmpty(objectName)) {
            return false;
        }
        return !objectName.contains("..")
                && !objectName.contains("/")
                && !objectName.contains("\\");
    }

    private String buildPublicUrl(String fileName) {
        return publicUploadPath + "/" + fileName;
    }
}
