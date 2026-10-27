pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
        timeout(time: 90, unit: 'MINUTES')
        skipDefaultCheckout(true)
    }

    environment {
        DOCKERHUB_CREDS = 'dockerhub-token'

        IMAGE_PREFIX       = 'ankithbv007/sfcs-unit2-backend'
        LOCAL_IMAGE_PREFIX = 'sfcs-unit2-backend'

        DEPLOY_HOST = '139.84.217.224'
        DEPLOY_USER = 'root'
        DEPLOY_DIR  = '/opt/sfcs-unit2'

        SSH_CREDENTIALS_ID = 'sfcs-production-ssh'

        BACKEND_SERVICES = 'backend-backend backend-inventory backend-login backend-pretest backend-qc-inspection backend-rrh backend-smt backend-vacuum-leak-test'
    }

    stages {

        // --------------------------------------------------
        // 1. CHECKOUT
        // --------------------------------------------------
        stage('Checkout') {
            steps {
                checkout scm

                script {
                    env.GIT_COMMIT_FULL = sh(
                        script: 'git rev-parse HEAD',
                        returnStdout: true
                    ).trim()

                    env.IMAGE_TAG = env.GIT_COMMIT_FULL.take(12)
                }

                echo "Full Git commit: ${env.GIT_COMMIT_FULL}"
                echo "Docker image tag: ${env.IMAGE_TAG}"

                sh '''
                    set -eu

                    git rev-parse --verify HEAD

                    if ! printf '%s' "$IMAGE_TAG" |
                        grep -Eq '^[0-9a-f]{12}$'; then
                        echo "ERROR: Invalid Docker image tag."
                        exit 1
                    fi

                    echo "Git checkout and image tag validation successful."
                '''
            }
        }

        // --------------------------------------------------
        // 2. CHECK DOCKER
        // --------------------------------------------------
        stage('Check Docker') {
            steps {
                sh '''
                    set -eu

                    echo "Checking Docker CLI..."
                    docker --version

                    echo "Checking Docker daemon..."
                    docker info >/dev/null

                    echo "Docker is available."
                '''
            }
        }

        // --------------------------------------------------
        // 3. BUILD ALL EIGHT BACKEND IMAGES
        // --------------------------------------------------
        stage('Build All Backend Images') {
            steps {
                sh '''
                    set -eu

                    for service in $BACKEND_SERVICES; do

                        echo "========================================"
                        echo "Building: $service"
                        echo "Image tag: $IMAGE_TAG"
                        echo "========================================"

                        if [ ! -f "$service/Dockerfile" ]; then
                            echo "ERROR: Dockerfile missing for $service"
                            exit 1
                        fi

                        docker build \
                            --pull \
                            -t "${LOCAL_IMAGE_PREFIX}-${service}:${IMAGE_TAG}" \
                            -f "$service/Dockerfile" \
                            "$service/"

                    done

                    echo "All eight backend images built successfully."
                '''
            }
        }

        // --------------------------------------------------
        // 4. PUSH ALL EIGHT IMAGES TO DOCKER HUB
        // --------------------------------------------------
        stage('Push Images to Docker Hub') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: "${DOCKERHUB_CREDS}",
                        usernameVariable: 'DOCKERHUB_USERNAME',
                        passwordVariable: 'DOCKERHUB_TOKEN'
                    )
                ]) {
                    sh '''
                        set -eu

                        # Keep Docker credentials in a temporary directory.
                        export DOCKER_CONFIG="$(mktemp -d)"
                        trap 'docker logout >/dev/null 2>&1 || true; rm -rf "$DOCKER_CONFIG"' EXIT

                        echo "Logging in to Docker Hub..."

                        printf '%s' "$DOCKERHUB_TOKEN" |
                            docker login \
                                --username "$DOCKERHUB_USERNAME" \
                                --password-stdin

                        for service in $BACKEND_SERVICES; do

                            LOCAL_IMAGE="${LOCAL_IMAGE_PREFIX}-${service}:${IMAGE_TAG}"
                            REMOTE_IMAGE="${IMAGE_PREFIX}-${service}:${IMAGE_TAG}"

                            echo "Tagging image: $REMOTE_IMAGE"

                            docker tag "$LOCAL_IMAGE" "$REMOTE_IMAGE"

                            echo "Pushing image: $REMOTE_IMAGE"

                            docker push "$REMOTE_IMAGE"

                        done

                        echo "All eight backend images pushed successfully."
                    '''
                }
            }
        }

        // --------------------------------------------------
        // 5. DEPLOY TO PRODUCTION
        // --------------------------------------------------
        stage('Deploy to Production') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: "${DOCKERHUB_CREDS}",
                        usernameVariable: 'DOCKERHUB_USERNAME',
                        passwordVariable: 'DOCKERHUB_TOKEN'
                    )
                ]) {
                    sshagent(credentials: ["${SSH_CREDENTIALS_ID}"]) {

                        sh '''
                            set -eu

                            SSH_OPTIONS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"

                            echo "Connecting to production server..."

                            # Remove the temporary remote Docker login when this
                            # deployment stage exits.
                            trap 'ssh $SSH_OPTIONS "$DEPLOY_USER@$DEPLOY_HOST" "docker logout" >/dev/null 2>&1 || true' EXIT

                            # Authenticate remotely so private Docker Hub images
                            # can be pulled if required.
                            printf '%s' "$DOCKERHUB_TOKEN" |
                                ssh $SSH_OPTIONS "$DEPLOY_USER@$DEPLOY_HOST" \
                                    "docker login --username '$DOCKERHUB_USERNAME' --password-stdin"

                            # Deploy the exact commit-tagged images built above.
                            ssh $SSH_OPTIONS "$DEPLOY_USER@$DEPLOY_HOST" \
                                "DEPLOY_DIR='$DEPLOY_DIR' BACKEND_TAG='$IMAGE_TAG' bash -s" <<'REMOTE_SCRIPT'

                            set -Eeuo pipefail

                            cd "$DEPLOY_DIR"

                            echo "Production directory: $DEPLOY_DIR"
                            echo "Backend image tag: $BACKEND_TAG"

                            if [ ! -f .env ]; then
                                echo "ERROR: Production .env file not found."
                                exit 1
                            fi

                            if ! printf '%s' "$BACKEND_TAG" |
                                grep -Eq '^[0-9a-f]{12}$'; then
                                echo "ERROR: Invalid backend image tag."
                                exit 1
                            fi

                            # Confirm Docker Compose can find the project.
                            docker compose version

                            # Save the current configuration for rollback.
                            BACKUP_FILE="$(mktemp)"
                            cp .env "$BACKUP_FILE"

                            OLD_BACKEND_TAG="$(
                                grep '^BACKEND_TAG=' .env |
                                tail -n 1 |
                                cut -d '=' -f 2- || true
                            )"

                            rollback_deployment() {
                                STATUS=$?
                                trap - ERR

                                echo "Deployment failed. Restoring previous .env..."

                                cp "$BACKUP_FILE" .env

                                if printf '%s' "$OLD_BACKEND_TAG" |
                                    grep -Eq '^[0-9a-f]{12}$'; then

                                    echo "Attempting rollback to $OLD_BACKEND_TAG"

                                    export BACKEND_TAG="$OLD_BACKEND_TAG"

                                    if docker compose pull \
                                        backend-backend \
                                        backend-inventory \
                                        backend-login \
                                        backend-pretest \
                                        backend-qc-inspection \
                                        backend-rrh \
                                        backend-smt \
                                        backend-vacuum-leak-test; then

                                        docker compose up -d --no-deps \
                                            backend-backend \
                                            backend-inventory \
                                            backend-login \
                                            backend-pretest \
                                            backend-qc-inspection \
                                            backend-rrh \
                                            backend-smt \
                                            backend-vacuum-leak-test || true
                                    fi
                                else
                                    echo "No valid previous commit tag found; automatic image rollback is unavailable."
                                fi

                                rm -f "$BACKUP_FILE"
                                exit "$STATUS"
                            }

                            trap rollback_deployment ERR

                            # Update BACKEND_TAG while preserving the other
                            # production environment variables.
                            if grep -q '^BACKEND_TAG=' .env; then
                                sed -i "s/^BACKEND_TAG=.*/BACKEND_TAG=$BACKEND_TAG/" .env
                            else
                                printf '\\nBACKEND_TAG=%s\\n' "$BACKEND_TAG" >> .env
                            fi

                            export BACKEND_TAG

                            echo "Validating Docker Compose configuration..."

                            docker compose config -q

                            echo "Pulling the new backend images..."

                            docker compose pull \
                                backend-backend \
                                backend-inventory \
                                backend-login \
                                backend-pretest \
                                backend-qc-inspection \
                                backend-rrh \
                                backend-smt \
                                backend-vacuum-leak-test

                            echo "Recreating backend containers..."

                            docker compose up -d --no-deps \
                                backend-backend \
                                backend-inventory \
                                backend-login \
                                backend-pretest \
                                backend-qc-inspection \
                                backend-rrh \
                                backend-smt \
                                backend-vacuum-leak-test

                            echo "Verifying backend containers are running..."

                            for service in \
                                backend-backend \
                                backend-inventory \
                                backend-login \
                                backend-pretest \
                                backend-qc-inspection \
                                backend-rrh \
                                backend-smt \
                                backend-vacuum-leak-test
                            do
                                RUNNING_CONTAINER="$(
                                    docker compose ps --status running -q "$service"
                                )"

                                if [ -z "$RUNNING_CONTAINER" ]; then
                                    echo "ERROR: $service is not running."
                                    false
                                fi

                                echo "OK: $service is running."
                            done

                            trap - ERR
                            rm -f "$BACKUP_FILE"

                            echo "Production backend deployment completed successfully."

                            REMOTE_SCRIPT

                            echo "Deployment command completed."
                        '''
                    }
                }
            }
        }
    }

    // --------------------------------------------------
    // 6. POST ACTIONS
    // --------------------------------------------------
    post {
        success {
            echo """
            SUCCESS: Backend pipeline completed.

            Git commit: ${env.GIT_COMMIT_FULL}
            Image tag:  ${env.IMAGE_TAG}

            All eight backend images were pushed to Docker Hub.
            Production deployment completed successfully.
            """
        }

        failure {
            echo 'Backend pipeline failed. Check the first failed stage in Console Output.'

            sh '''
                set +e

                for service in $BACKEND_SERVICES; do
                    docker image rm \
                        "${LOCAL_IMAGE_PREFIX}-${service}:${IMAGE_TAG}" \
                        >/dev/null 2>&1
                done

                echo "Local build image cleanup attempted."
            '''
        }

        always {
            echo 'Backend CI/CD pipeline execution completed.'
        }
    }
}
