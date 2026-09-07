package com.kuocai.cdn.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.sql.init.SqlDataSourceScriptDatabaseInitializer;
import org.springframework.boot.jdbc.init.DataSourceScriptDatabaseInitializer;
import org.springframework.boot.sql.init.DatabaseInitializationMode;
import org.springframework.boot.sql.init.DatabaseInitializationSettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Collections;

/**
 * Auto-initializes an empty database on startup: runs schema-init.sql
 * (14 tables) and init-data.sql (bootstrap rows) only when the sys_config
 * table is absent, so an already-initialized database is never touched.
 * Users only need to create the empty database; table creation and
 * bootstrap data are handled here.
 */
@Slf4j
@Configuration
public class DatabaseInitConfig {

    @Bean
    public DataSourceScriptDatabaseInitializer databaseScriptInitializer(DataSource dataSource) {
        DatabaseInitializationSettings settings = new DatabaseInitializationSettings();
        settings.setMode(DatabaseInitializationMode.ALWAYS);
        settings.setEncoding(StandardCharsets.UTF_8);
        settings.setContinueOnError(false);
        if (schemaPresent(dataSource)) {
            log.info("数据库已初始化，跳过自动建库脚本");
            settings.setSchemaLocations(Collections.emptyList());
            settings.setDataLocations(Collections.emptyList());
        } else {
            log.info("检测到空数据库，开始自动初始化表结构与基础数据");
            settings.setSchemaLocations(Collections.singletonList("classpath:sql/schema-init.sql"));
            settings.setDataLocations(Collections.singletonList("classpath:sql/init-data.sql"));
        }
        return new SqlDataSourceScriptDatabaseInitializer(dataSource, settings);
    }

    private boolean schemaPresent(DataSource dataSource) {
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "SELECT COUNT(*) FROM information_schema.tables "
                             + "WHERE table_schema = DATABASE() AND table_name = 'sys_config'");
             ResultSet resultSet = statement.executeQuery()) {
            return resultSet.next() && resultSet.getInt(1) > 0;
        } catch (SQLException e) {
            throw new IllegalStateException("无法检查数据库初始化状态", e);
        }
    }
}
