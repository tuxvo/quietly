# Build and run Quietly in a container. Not tested where it was written (no Docker available), so check it on your host.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish Quietly.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .

# The database and cookie keys go in /data. Mount a persistent volume there on your host, or everything is lost on each redeploy.
# (Runs as root so that a mounted volume, which is often root-owned, is writable. On a locked-down host you can switch to a normal user
# and fix the volume's ownership instead.)
RUN mkdir -p /data
ENV ASPNETCORE_FORWARDEDHEADERS_ENABLED=true \
    Quietly__DataDirectory=/data
EXPOSE 8080
# Listens on the PORT the host provides (Railway, Render and others set it), or 8080 if there isn't one.
ENTRYPOINT ["sh", "-c", "ASPNETCORE_URLS=http://+:${PORT:-8080} exec dotnet Quietly.dll"]
