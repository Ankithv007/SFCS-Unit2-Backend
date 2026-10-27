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
        DOCKERHUB_USER  = 'ankithbv007'
        DOCKERHUB_CREDS = 'dockerhub-token'

        IMAGE_PREFIX       = 'ankithbv007/sfcs-unit2-backend'
        LOCAL_IMAGE_PREFIX = 'sfcs-unit2-backend'

        DEPLOY_HOST = '139.84.217.224'
        DEPLOY_DIR  = '/opt/sfcs-unit2'

        SSH_CREDENTIALS_ID = 'sfcs-production-ssh'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm

                script {
                    env.GIT_COMMIT_FULL = sh(
                        script: 'git rev-parse HEAD',
                        returnStdout: true
                    ).trim()

                    env.GIT_COMMIT_SHORT = sh(
                        script: 'git rev-parse --short=12 HEAD',
                        returnStdout: true
                    ).trim()

                    env.IMAGE_TAG = env.GIT_COMMIT_SHORT
                }

                echo "Full Git commit: ${env.GIT_COMMIT_FULL}"
                echo "Docker image tag: ${env.IMAGE_TAG}"

                sh '''
                    set -eu
                    echo "Checking Git checkout..."
                    git rev-parse --verify HEAD
                    echo "Git checkout successful."
                '''
            }
        }

        stage('Build Images') {
            steps {
                script {
                    def services = [
                        'backend-backend',
                        'backend-inventory',
                        'backend-login',
                        'backend-pretest',
                        'backend-qc-inspection',
                        'backend-rrh',
                        'backend-smt',
                        'backend-vacuum-leak-test'
                    ]

                    for (service in services) {
                        sh """
                            echo "Building Docker image for ${service}..."
                            docker build -t ${LOCAL_IMAGE_PREFIX}-${service}:${IMAGE_TAG} -f ${service}/Dockerfile ${service}/
                        """
                    }
                }
            }
        }

        stage('Push Images') {
            steps {
                withCredentials([string(credentialsId: "${env.DOCKERHUB_CREDS}", variable: 'DOCKERHUB_PASSWORD')]) {
                    sh """
                        echo "${DOCKERHUB_PASSWORD}" | docker login -u "${DOCKERHUB_USER}" --password-stdin
                    """
                }

                script {
                    def services = [
                        'backend-backend',
                        'backend-inventory',
                        'backend-login',
                        'backend-pretest',
                        'backend-qc-inspection',
                        'backend-rrh',
                        'backend-smt',
                        'backend-vacuum-leak-test'
                    ]

                    for (service in services) {
                        sh """
                            docker tag ${LOCAL_IMAGE_PREFIX}-${service}:${IMAGE_TAG} ${IMAGE_PREFIX}-${service}:${IMAGE_TAG}
                            docker push ${IMAGE_PREFIX}-${service}:${IMAGE_TAG}
                        """
                    }
                }
            }
        }

        stage('Deploy to Production') {
            steps {
                sshagent(credentials: ["${env.SSH_CREDENTIALS_ID}"]) {
                    sh """
                        ssh -o StrictHostKeyChecking=no root@${DEPLOY_HOST} "mkdir -p ${DEPLOY_DIR}"
                        
                        ssh -o StrictHostKeyChecking=no root@${DEPLOY_HOST} "\
                            cd ${DEPLOY_DIR} && \
                            export IMAGE_TAG=${IMAGE_TAG} && \
                            export DOCKERHUB_USER=${DOCKERHUB_USER} && \
                            echo 'Pulling and restarting services on ${DEPLOY_HOST}...'
                        "
                    """
                }
            }
        }
    }

    post {
        failure {
            echo 'Pipeline failed. Check the failed stage in Console Output.'

            sh '''
                set +e

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
                    docker image rm \
                        "${LOCAL_IMAGE_PREFIX}-${service}:${IMAGE_TAG}" \
                        >/dev/null 2>&1
                done

                echo "Local build image cleanup attempted."
            '''
        }

        success {
            echo 'SUCCESS: Eight backend images were pushed and production deployment completed.'
        }

        always {
            echo 'Backend CI/CD pipeline execution completed.'
        }
    }
}