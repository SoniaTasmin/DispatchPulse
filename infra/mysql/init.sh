#!/bin/sh
# Runs once, when the MySQL data volume is empty. Re-run with: docker compose down -v
# Each service gets its own database and user. The *_shadow databases are scratch space
# that `prisma migrate dev` needs to detect schema drift; the *_test databases are for integration tests.
set -eu

mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE dispatchpulse;
CREATE DATABASE dispatchpulse_shadow;
CREATE DATABASE dispatchpulse_test;
CREATE DATABASE dispatchpulse_notifications;
CREATE DATABASE dispatchpulse_notifications_shadow;
CREATE DATABASE dispatchpulse_notifications_test;

CREATE USER 'dispatchpulse_api'@'%' IDENTIFIED BY '$API_DB_PASSWORD';
GRANT ALL PRIVILEGES ON dispatchpulse.* TO 'dispatchpulse_api'@'%';
GRANT ALL PRIVILEGES ON dispatchpulse_shadow.* TO 'dispatchpulse_api'@'%';
GRANT ALL PRIVILEGES ON dispatchpulse_test.* TO 'dispatchpulse_api'@'%';

CREATE USER 'dispatchpulse_worker'@'%' IDENTIFIED BY '$WORKER_DB_PASSWORD';
GRANT ALL PRIVILEGES ON dispatchpulse_notifications.* TO 'dispatchpulse_worker'@'%';
GRANT ALL PRIVILEGES ON dispatchpulse_notifications_shadow.* TO 'dispatchpulse_worker'@'%';
GRANT ALL PRIVILEGES ON dispatchpulse_notifications_test.* TO 'dispatchpulse_worker'@'%';
SQL
