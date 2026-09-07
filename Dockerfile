FROM eclipse-temurin:8-jre

ENV TZ=Asia/Shanghai

WORKDIR /app

COPY target/multi-cloud-cdn-M1.0.0.jar /app/app.jar

EXPOSE 8000

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
