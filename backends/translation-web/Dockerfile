FROM python:3.12-bookworm
RUN apt-get update && apt-get install -y default-libmysqlclient-dev gcc
WORKDIR /usr/src
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
