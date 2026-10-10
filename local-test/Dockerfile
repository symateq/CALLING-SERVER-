# Local, disposable Asterisk instance matching the live calling server's exact
# OS and package version (Ubuntu 24.04 LTS, asterisk 1:20.6.0~dfsg+~cs6.13.40431414-2build5),
# used only to prove the WebRTC transport/endpoint/echo-extension config
# before it ever touches the live server. No Telnyx trunk, no real
# credentials, no 101/102 -- those aren't needed to validate this addition.
FROM ubuntu:24.04

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        asterisk=1:20.6.0~dfsg+~cs6.13.40431414-2build5 \
        asterisk-core-sounds-en \
    && rm -rf /var/lib/apt/lists/*

COPY config/pjsip.conf.sample /etc/asterisk/pjsip.conf
COPY config/extensions.conf.sample /etc/asterisk/extensions.conf
COPY config/http.conf.sample /etc/asterisk/http.conf
COPY config/modules.conf.sample /etc/asterisk/modules.conf
COPY config/rtp.conf.sample /etc/asterisk/rtp.conf

EXPOSE 8088
EXPOSE 20000-20010/udp

CMD ["asterisk", "-f", "-vvv"]
